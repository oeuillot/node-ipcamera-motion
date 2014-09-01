var fs = require('fs');
var path = require('path');

var LF = 10;
var CR = 13;

function MjpegScanner(path) {
	this._path = path;

	this._offset = 0;
	this._closed = false;
}

// Util.inherits(MotionDetector, Events.EventEmitter);
module.exports = MjpegScanner;

var proto = {
	getHeaderProperties: function(callback) {
		if (this._headers) {
			return callback(null, this._headers);
		}

		var self = this;
		this._readNextHeader(function(error, properties) {
			if (error) {
				return callback(error);
			}

			self._headers = properties;

			callback(null, properties);
		});
	},

	nextFrameInfos: function(callback) {

		var self = this;
		if (!this._headers) {
			return this.getHeaderProperties(function(error, properties) {
				if (error) {
					return callback(error);
				}

				self.nextFrameInfos(callback);
			});
		}

		this._readNextHeader(callback);
	},

	_readNextHeader: function(callback, bufferSize) {

		if (this._closed) {
			return callback(null, null);
		}

		var self = this;

		if (!this._fd) {
			return fs.open(this._path, "r", function(error, fd) {
				if (error) {
					return callback(error);
				}

				self._fd = fd;

				fs.lstat(self._path, function(error, stats) {
					if (error) {
						return callback(error);
					}

					self._stats = stats;

					return self._readNextHeader(callback, bufferSize);
				});
			});
		}

		var offset = this._offset;

		var buf = new Buffer(bufferSize || 1024);
		fs.read(this._fd, buf, 0, buf.length, offset, function(error, bytesRead) {
			if (error) {
				console.error(error);

				return self.close(function() {
					callback(error);
				});
			}

			if (bytesRead < 4) {
				return self.close(function(error) {
					return callback(error, null);
				});
			}

			self._parseProperties(buf, bytesRead, function(error, properties, len) {

				if (error) {
					return self._readNextHeader(callback, 1024 * 8);
				}

				var ret = {
					path: self._path
				};

				len += 3; // \n\r\n

				// ret.headerOffset = self._offset;

				self._offset += len;

				ret.bodyOffset = self._offset;

				var cl = properties['Content-Length'];
				if (cl) {
					ret.bodyLength = parseInt(cl, 10);

					self._offset += ret.bodyLength;

					self._offset += 2;
				}

				var ds = properties['X-Image-Date'];
				if (ds) {
					ret.imageDate = (new Date(ds)).getTime();
				}

				if (false) {
					var buf2 = new Buffer(128);
					var b2 = fs.readSync(self._fd, buf2, 0, 128, ret.bodyOffset);

					console.log(buf2);
				}

				return callback(null, ret);
			});
		});
	},

	_searchMark: function(buf, len, position) {
		for (; position < len - 4; position += 4) {
			var p = buf[position];
			if (p < 0) {
				return -1;
			}

			if (p === CR) {
				if (buf[position + 1] === LF) {
					if (buf[position + 2] === CR) {
						if (buf[position + 3] === LF) {
							return position;
						}
					}
				}
				if (buf[position - 1] === LF) {
					if (buf[position - 2] === CR) {
						if (buf[position + 1] === LF) {
							return position - 2;
						}
					}
				}
				continue;
			}

			if (p === LF) {
				if (buf[position - 1] === CR) {
					if (buf[position + 1] === CR) {
						if (buf[position + 2] === LF) {
							return position - 1;
						}
					}

					if (buf[position - 2] === LF) {
						if (buf[position - 3] === CR) {
							return position - 3;
						}
					}
				}

				continue;
			}
		}
	},

	_parseProperties: function(buf, bytesRead, callback) {
		var pos = this._searchMark(buf, bytesRead, 0);
		if (pos < 0) {
			return callback("Can not found end of buffer");
		}

		var str = buf.toString('binary', 0, pos);

		var sa = str.replace(/\r\n/gm, "\n").split('\n');

		var ret = {};
		sa.forEach(function(s) {
			var m = /^([^:]+): (.+)/g.exec(s);

			if (!m || m.length < 2) {
				return;
			}

			ret[m[1]] = m[2];
		});

		// console.log("h=", str);

		return callback(null, ret, pos + 1);
	},

	close: function(callback) {
		this._closed = true;

		var fd = this._fd;
		if (!fd) {
			return callback();
		}
		this._fd = undefined;

		return fs.close(fd, callback);
	}
};

for ( var i in proto) {
	MjpegScanner.prototype[i] = proto[i];
}
