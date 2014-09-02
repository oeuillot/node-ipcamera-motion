var fs = require('fs');
var path = require('path');
var RBTree = require('bintrees').RBTree;
var MjpegScanner = require('./mjpegScanner');
var Async = require('async');
var fs = require('fs');
var Path = require('path');

var DEFAULT_HASH_SECOND = 60 * 15;

function MoviesRepository(configuration) {
	this._path = configuration.path;
	this._hashMilliseconds = (configuration.hashSecond || DEFAULT_HASH_SECOND) * 1000;

	this._filesTree = new RBTree(function(img1, img2) {
		return img1.dateKey - img2.dateKey;
	});

	this._imagesTree = new RBTree(function(img1, img2) {
		if (!img1) {
			return 1;
		}
		if (!img2) {
			return -1;
		}
		return img1.imageDate - img2.imageDate;
	});

	this._scanDirectories(this._path, function(error) {
		if (error) {
			console.error("Scan error ", error);
			return;
		}
	});
}

// Util.inherits(MotionDetector, Events.EventEmitter);
module.exports = MoviesRepository;

var proto = {

	getImage: function(date, callback) {
		var image = this._imagesTree.find({
			imageDate: date.getTime()
		});

		if (image) {
			return callback(null, image);
		}

		var dcurrent = this._computeDateKey(date.getTime());
		var dbefore = dcurrent - 1;

		var self = this;
		this._processFiles(dbefore, function(error) {
			if (error) {
				return callback(error);
			}

			self._processFiles(dcurrent, function(error) {
				if (error) {
					return callback(error);
				}

				image = self._imagesTree.find({
					imageDate: date.getTime()
				});

				return callback(null, image);
			});
		});
	},
	listImages: function(from, callback) {
		var cursorTime = from.getTime();

		console.log("Request list from " + this._computeDateKey(from));

		var iter = this._imagesTree.upperBound({
			imageDate: cursorTime - 1
		});

		var self = this;

		return callback(null, {
			next: function computeNext(callback) {
				var n = iter.data();
				iter.next();

				console.log("Iter images => ", n);

				if (!n) {
					// On recherche s'il y a d'autres images plus tard (pas encore
					// analysées)

					console.log("Request iter 2=" + (self._computeDateKey(cursorTime)));
					var iter2 = self._filesTree.upperBound({
						dateKey: self._computeDateKey(cursorTime) - 1
					});
					var n2 = iter2.data();
					if (!n2) {
						// Vide c'est la fin !

						console.log("No more... " + self._computeDateKey(cursorTime));

						return callback(null, null);
					}

					// Non vide
					self._processFiles(n2.dateKey, function(error) {
						if (error) {
							return callback(error);
						}

						iter = self._imagesTree.upperBound({
							imageDate: cursorTime - 1
						});

						return computeNext(callback);
					});
					return;
				}

				var currentDateKey = self._computeDateKey(n.imageDate);
				if (currentDateKey === self._computeDateKey(cursorTime)) {
					// Même dateKey, on retourne tout de suite
					console.log("Same date Key " + self._computeDateKey(cursorTime));
					cursorTime = n.imageDate;
					return callback(null, n);
				}

				var iter3 = self._filesTree.upperBound({
					dateKey: self._computeDateKey(cursorTime) - 1
				});
				var n3 = iter3.data();
				console.log("Not same key (" + self._computeDateKey(cursorTime) + ", search next =", n3);

				if (!n3 || n3.dateKey > currentDateKey) {
					cursorTime = n.imageDate;
					return callback(null, n);
				}

				// Il y a des images au milieu
				self._processFiles(n3.dateKey, function(error) {
					if (error) {
						console.error(error);
						return callback(error);
					}

					iter = self._imagesTree.upperBound({
						imageDate: cursorTime - 1
					});

					return computeNext(callback);
				});
			}
		});
	},

	_processFiles: function(dateKey, callback) {
		var self = this;

		console.log("Process file of " + dateKey);

		var ps = self._filesTree.find({
			dateKey: dateKey
		});

		if (!ps) {
			return callback(null, 0);
		}

		self._filesTree.remove(ps);

		console.log("Process paths: ", ps.paths);

		var cnt = 0;
		function process() {
			var p = ps.paths.shift();
			if (!p) {
				return callback(null, cnt);
			}
			console.log("   Item #" + (cnt) + " " + p);

			cnt++;
			self._scanFile(p, function(error) {
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

		var self = this;
		function nextFrame() {
			scanner.nextFrameInfos(function(error, properties) {
				if (error) {
					return callback(error);
				}
				if (!properties) {
					return scanner.close(callback);
				}

				self._imagesTree.insert(properties);

				setImmediate(nextFrame);
			});
		}

		nextFrame();
	},

	_scanDirectories: function(directory, callback) {

		var self = this;
		this._listDirectoryContents(directory, directory, [], function(error, files) {
			if (error) {
				return callback(error);
			}

			console.log(files.length + " detected files in " + self._filesTree.size + " timeblocks");

			var cnt = 0;
			Async.eachLimit(files, 4, function(item, callback) {
				var scanner = new MjpegScanner(item);
				cnt++;

				scanner.nextFrameInfos(function(error, properties) {
					if (error) {
						return callback(error);
					}

					if (properties) {
						var dateKey = self._computeDateKey(properties.imageDate);

						var ps = self._filesTree.find({
							dateKey: dateKey
						});
						if (!ps) {
							ps = {
								paths: [],
								dateKey: dateKey
							};
							self._filesTree.insert(ps);

							console.log("Create timeBlock " + dateKey);
						}

						ps.paths.push(properties.path);
					}

					return scanner.close(callback);
				});

			}, function(error) {
				if (error) {
					return callback(error);
				}

				console.log(self._filesTree.size + " timeblocks created");

			});
		});
	},

	_listDirectoryContents: function(rootPath, path, list, callback) {

		var self = this;
		fs.readdir(path, function(error, files) {
			Async.each(files, function(file, callback) {
				var p = Path.join(path, file);

				fs.lstat(p, function(error, stats) {
					if (error) {
						console.error("LStat " + p + " error", error);
						return callback(error);
					}

					if (stats.isDirectory()) {
						return self._listDirectoryContents(rootPath, p, list, callback);
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
	}
};

for ( var i in proto) {
	MoviesRepository.prototype[i] = proto[i];
}