var fs = require('fs');
var path = require('path');
var RBTree = require('bintrees').RBTree;
var MjpegScanner = require('./mjpegScanner');
var Async = require('async');
var fs = require('fs');
var Path = require('path');

var DEFAULT_HASH_SECOND = 60 * 15;

var LOG = false;

function MoviesRepository(configuration) {
	this._path = configuration.path;
	this._stateDate = Date.now();
	this._hashMilliseconds = (configuration.hashSecond || DEFAULT_HASH_SECOND) * 1000;

	this._pendingFilesTree = new RBTree(function(img1, img2) {
		if (!img1) {
			return -1;
		}
		if (!img2) {
			return 1;
		}
		return img1.dateKey - img2.dateKey;
	});

	this._moviesTree = new RBTree(function(v1, v2) {
		if (!v1) {
			return -1;
		}
		if (!v2) {
			return 1;
		}
		return v1.imageDate - v2.imageDate;
	});

	this._imagesTree = new RBTree(function(img1, img2) {
		if (!img1) {
			return -1;
		}
		if (!img2) {
			return 1;
		}
		return img1.imageDate - img2.imageDate;
	});

	this._scanDirectories(this._path, function(error) {
		if (error) {
			console.error("Scan error ", error);
			return;
		}
	});

	this._watching = {};

	var self = this;
	fs.watch(this._path, function(event, filename) {
		self._watchEvent(self._path, event, filename);
	});
}

// Util.inherits(MotionDetector, Events.EventEmitter);
module.exports = MoviesRepository;

var proto = {

	getStateId: function() {
		return "S" + this._stateDate;
	},

	getImage: function(date, callback) {
		var image = this._imagesTree.find({
			imageDate: date.getTime()
		});

		if (image) {
			return callback(null, image);
		}

		var self = this;
		this._verifyPendingFiles(date, function(error) {
			if (error) {
				return callback(error);
			}

			var iter = self._imagesTree.lowerBound({
				imageDate: date.getTime()
			});
			image = iter.data();

			return callback(null, image);
		});
	},
	_verifyPendingFiles: function(date, callback) {

		var dcurrent = this._computeDateKey(date.getTime());
		var dbefore = dcurrent - 1;

		var self = this;
		this._processPendingFiles(dbefore, function(error) {
			if (error) {
				return callback(error);
			}

			self._processPendingFiles(dcurrent, function(error) {
				return callback(error);
			});
		});
	},
	listImages: function(from, callback) {
		var self = this;

		this._verifyPendingFiles(from, function(error) {
			if (error) {
				return callback(error);
			}

			self._listNodes(self._imagesTree, from, callback);
		});
	},
	listMovies: function(from, callback) {
		var self = this;

		this._verifyPendingFiles(from, function(error) {
			if (error) {
				return callback(error);
			}

			self._listNodes(self._moviesTree, from, callback);
		});
	},
	_listNodes: function(tree, from, callback) {
		var cursorTime = from.getTime();

		if (LOG) {
			console.log("Request list from " + this._computeDateKey(from));
		}

		var iter = tree.lowerBound({
			imageDate: cursorTime
		});

		var self = this;

		return callback(null, {
			next: function computeNext(callback) {
				var n = iter.data();
				iter.next();

				if (LOG) {
					console.log("Iter items => ", n);
				}

				if (!n) {
					// On recherche s'il y a d'autres images plus tard (pas encore
					// analysées)

					if (LOG) {
						console.log("Request iter 2=" + (self._computeDateKey(cursorTime)));
					}

					var iter2 = self._pendingFilesTree.lowerBound({
						dateKey: self._computeDateKey(cursorTime)
					});
					var n2 = iter2.data();
					if (!n2) {
						// Vide c'est la fin !

						if (LOG) {
							console.log("No more... " + self._computeDateKey(cursorTime));
						}

						return callback(null, null);
					}

					// Non vide
					self._processPendingFiles(n2.dateKey, function(error) {
						if (error) {
							return callback(error);
						}

						iter = tree.lowerBound({
							imageDate: cursorTime
						});

						return computeNext(callback);
					});
					return;
				}

				var currentDateKey = self._computeDateKey(n.imageDate);
				if (currentDateKey === self._computeDateKey(cursorTime)) {
					// Même dateKey, on retourne tout de suite
					if (LOG) {
						console.log("Same date Key " + self._computeDateKey(cursorTime));
					}
					cursorTime = n.imageDate;
					return callback(null, n);
				}

				var iter3 = self._pendingFilesTree.lowerBound({
					dateKey: self._computeDateKey(cursorTime)
				});
				var n3 = iter3.data();
				if (LOG) {
					console.log("Not same key (" + self._computeDateKey(cursorTime) + ", search next =", n3);
				}

				if (!n3 || n3.dateKey > currentDateKey) {
					cursorTime = n.imageDate;
					return callback(null, n);
				}

				// Il y a des images au milieu
				self._processPendingFiles(n3.dateKey, function(error) {
					if (error) {
						console.error(error);
						return callback(error);
					}

					iter = tree.lowerBound({
						imageDate: cursorTime
					});

					return computeNext(callback);
				});
			}
		});
	},

	_processPendingFiles: function(dateKey, callback) {
		var self = this;

		if (LOG) {
			console.log("Process pending file of " + dateKey);
		}

		var ps = self._pendingFilesTree.find({
			dateKey: dateKey
		});

		if (!ps) {
			return callback(null, 0);
		}

		self._pendingFilesTree.remove(ps);

		if (LOG) {
			console.log("Process paths: ", ps.paths);
		}

		var cnt = 0;
		function process() {
			var p = ps.paths.shift();
			if (!p) {
				return callback(null, cnt);
			}
			if (LOG) {
				console.log("   Item #" + (cnt) + " " + p);
			}

			cnt++;
			self._scanFile(p, function(error) {
				if (LOG) {
					console.log("   End of Item #" + (cnt) + " " + p);
				}
				if (error) {
					return callback(error);
				}

				setImmediate(process);
			});
		}

		process();
	},

	_scanFile: function(path, callback) {
		var scanner = new MjpegScanner(path);

		var frames = [];
		var first = true;

		var self = this;
		function nextFrame() {
			scanner.nextFrameInfos(function(error, properties) {
				if (error) {
					return callback(error);
				}
				if (!properties) {
					return scanner.close(callback);
				}

				if (LOG) {
					console.log("INSERT ", properties);
				}

				if (first) {
					first = false;
					self._moviesTree.insert({
						path: path,
						frames: frames,
						imageDate: properties.imageDate
					});
				}
				frames.push(properties.imageDate);

				self._imagesTree.insert(properties);

				self._stateDate = Date.now();

				setImmediate(nextFrame);
			});
		}

		nextFrame();
	},

	_scanFiles: function(files, callback) {
		var cnt = 0;
		var self = this;

		Async.eachLimit(files, 4, function(item, callback) {
			if ((cnt % 1000) === 0) {
				console.log("Scanning directory ... (" + cnt + ")");
			}

			var scanner = new MjpegScanner(item);
			cnt++;

			scanner.nextFrameInfos(function(error, properties) {
				if (error) {
					return callback(error);
				}

				if (properties) {
					var dateKey = self._computeDateKey(properties.imageDate);

					var ps = self._pendingFilesTree.find({
						dateKey: dateKey
					});
					if (!ps) {
						ps = {
							paths: [],
							dateKey: dateKey
						};
						self._pendingFilesTree.insert(ps);

						self._stateDate = Date.now();

						if (LOG) {
							console.log("Create timeBlock " + dateKey);
						}
					}

					ps.paths.push(properties.path);
				}

				return scanner.close(callback);
			});

		}, callback);
	},

	_scanDirectories: function(directory, callback) {
		console.log("Scan directory", directory);

		var self = this;
		this._listDirectoryContents(directory, [], function(error, files) {
			if (error) {
				return callback(error);
			}

			console.log(files.length + " detected files in " + self._pendingFilesTree.size + " timeblocks");

			self._scanFiles(files, function(error) {
				if (error) {
					return callback(error);
				}

				console.log(self._pendingFilesTree.size + " timeblocks created");
			});
		});
	},

	_listDirectoryContents: function(path, list, callback) {

		var self = this;

		fs.watch(path, function(event, filename) {
			self._watchEvent(path, event, filename);
		});

		fs.readdir(path, function(error, files) {
			Async.each(files, function(file, callback) {
				var p = Path.join(path, file);

				fs.lstat(p, function(error, stats) {
					if (error) {
						console.error("lstat " + p + " error", error);
						return callback(error);
					}

					if (stats.isDirectory()) {
						return self._listDirectoryContents(p, list, callback);
					}

					if (stats.isFile()) {
						if (p.match(/\.mjpeg$/g)) {
							list.push(p);
						}
					}

					return callback();
				});

			}, function(error) {
				if (error) {
					return callback(error);
				}

				return callback(null, list);
			});
		});
	},

	_computeDateKey: function(ms) {
		return Math.floor(ms / this._hashMilliseconds);
	},

	_watchEvent: function(path, event, filename) {

		var self = this;

		if (!filename || !path) {
			return;
		}

		var p2 = Path.join(path, filename);

		var tid = this._watching[p2];
		if (tid) {
			clearTimeout(tid);
		}

		tid = setTimeout(function() {
			delete self._watching[p2];

			if (LOG) {
				console.log("Change event: ", path, event, filename, p2);
			}

			fs.lstat(p2, function(error, stats) {
				if (error) {
					if (error.code === 'ENOENT') {
						// TODO process removed ressource !
						return;
					}
					console.error("lstat " + p2 + " error", error);
					return;
				}
				if (stats.isDirectory()) {
					return self._scanDirectories(p2, function(error) {
						if (error) {
							console.error(error);
							return;
						}
						console.log("INotify: Add directory", p2);
					});
				}

				if (stats.isFile()) {
					if (p2.match(/\.mjpeg$/g)) {
						self._scanFiles([ p2 ], function(error) {
							if (error) {
								console.error(error);
								return;
							}

							console.log("INotify: Add file", p2);
						});
					}
				}
			});
		}, 1000);

		this._watching[p2] = tid;
	},

	lastMovies: function(size, callback) {

		var list = [];
		function moviesIterator() {
			return callback(null, {
				next: function(callback) {
					return callback(null, list.shift());
				}
			});
		}

		var self = this;

		var pendingMax = this._pendingFilesTree.max();
		var moviesMax = this._moviesTree.max();
		if (pendingMax) {
			if (!moviesMax || pendingMax.dateKey >= this._computeDateKey(moviesMax.imageDate) - 1) {
				this._processPendingFiles(pendingMax.dateKey, function(error) {
					if (error) {
						return callback(error);
					}
					return self.lastMovies(size, callback);
				});
				return;
			}
		} else if (!moviesMax) {
			return moviesIterator();
		}

		var cur = moviesMax;
		list.push(moviesMax);

		size--;
		if (!size) {
			return moviesIterator();
		}

		function last() {
			var iter = self._pendingFilesTree.lowerBound({
				dateKey: self._computeDateKey(cur.imageDate)
			});
			iter.prev();
			var pending = iter.data();

			var iter2 = self._moviesTree.lowerBound(cur);
			iter2.prev();
			var prev = iter2.data();

			// console.log("Pending=", pending, " prev=", prev);

			if (pending) {
				if (!prev || pending.dateKey >= self._computeDateKey(prev.imageDate) - 1) {
					self._processPendingFiles(pending.dateKey, function(error) {
						if (error) {
							return callback(error);
						}
						last();
					});
					return;
				}
			} else if (!prev) {
				return moviesIterator();
			}

			list.push(prev);

			cur = prev;

			size--;
			if (!size) {
				return moviesIterator();
			}

			last();
		}

		last();
	}
};

for ( var i in proto) {
	MoviesRepository.prototype[i] = proto[i];
}