var express = require('express');
var compression = require('compression');
var program = require('commander');
var fs = require('fs');
var gm = require('gm');
var MoviesRepository = require('./lib/moviesRepository');

var NO_CACHE_CONTROL = "no-cache, private, no-store, must-revalidate, max-stale=0, max-age=1,post-check=0, pre-check=0";

var MAX_SIZE = 512;
var LAST_MOVIES_MAX_SIZE = 64;

program.option("--httpPort <port>", "HttpPort", parseInt);

program.option("--storePath <path>", "Store path");

program.option("--heapdump", "Enable heapdump");

program.parse(process.argv);

if (!program.storePath) {
	throw new Error("storePath parameter must be specified");
}
if (program.heapdump) {
	var heapdump = require("heapdump");
}

var moviesRepository = new MoviesRepository({
	path: program.storePath
});

var app = express();
app.use(compression({
  threshold: 512
}));

function sendImage(res, imagePath, imageOffset, imageSize, imageDate, callback) {

	fs.open(imagePath, "r", function(error, fd) {
		if (error) {
			console.error(error);

			res.status(505);
			return callback(error);
		}

		res.writeHead(200, {
			'Content-Type': 'image/jpeg',
			'Content-Length': String(imageSize),
			'X-Image-Date': (new Date(imageDate)).toISOString()
		});

		var buf = new Buffer(1024 * 64);
		var pos = imageOffset;
		var size = imageSize;

		function writeBuf() {
			fs.read(fd, buf, 0, Math.min(buf.length, size), pos, function(error, byteRead) {
				if (error) {
					console.error(error);

					res.end();
					fs.close(fd);
					return callback(error);
				}

				// console.log("Read " + byteRead + " bytes");

				var buf2 = buf;
				if (byteRead !== buf.length) {
					buf2 = buf.slice(0, byteRead);
				}

				res.write(buf2, function(error) {
					if (error) {
						console.error(error);

						res.end();
						fs.close(fd);
						return callback(error);
					}

					// console.log("Write " + byteRead + " bytes");

					pos += byteRead;
					size -= byteRead;

					if (size <= 0) {
						res.end();
						fs.close(fd);
						return callback(null);
					}

					writeBuf();
				});
			});
		}

		writeBuf();
	});
}

function fileToBuffer(imagePath, pos, size, callback) {

	fs.open(imagePath, "r", function(error, fdSource) {
		if (error) {
			return callback(error);
		}

		var buffer = new Buffer(size);
		var bufPos = 0;

		function writeBuf() {
			fs.read(fdSource, buffer, bufPos, Math.min(buffer.length, size), pos, function(error, byteRead) {
				if (error) {
					fs.close(fdSource);
					return callback(error);
				}

				pos += byteRead;
				bufPos += byteRead;
				size -= byteRead;

				if (size <= 0) {
					fs.close(fdSource);
					return callback(null, buffer);
				}

				setImmediate(writeBuf);
			});
		}

		writeBuf();
	});
}

app.get("/get/:date", function(req, res) {

	var date = req.params.date;
	if (!date) {
		res.status(404).send("Invalid date parameter");
		return;
	}

	if (date.indexOf('T') < 0) {
		date = parseInt(date, 10);
	}

	date = new Date(date);
	var image = moviesRepository.getImage(date, function(error, image) {
		if (error) {
			console.error(error);

			res.status(505);
			return;
		}

		if (!image) {
			res.status(404).send("Invalid image not found");
			return;
		}

		if (req.query) {
			var width = req.query.width;
			if (width) {

				// console.info("Process width=" + width);

				fileToBuffer(image.path, image.bodyOffset, image.bodyLength, function(error, buffer) {

					// console.info("Save file to ", tmpPath);
					if (error) {
						console.error(error);
						res.status(505);
						return;
					}

					gm(buffer).resize(width).toBuffer("JPG", function(error, buffer) {
						if (error) {
							console.error(error);
							res.status(505);
							return;
						}

						res.writeHead(200, {
							'Content-Type': 'image/jpeg',
							'Content-Length': String(buffer.length),
							'X-Image-Date': (new Date(image.imageDate)).toISOString()
						});

						res.write(buffer);
						res.end();
					});

				});

				return;
			}
		}

		sendImage(res, image.path, image.bodyOffset, image.bodyLength, image.imageDate, function(error) {
			if (error) {
				console.error(error);
			}
		});
	});
});

function returnList(from, etag, req, res, writeItemFunc) {
	var size = req.query.size || MAX_SIZE;
	if (size <= 0 || !size || size > MAX_SIZE) {
		size = MAX_SIZE;
	}
	var step = req.query.step;
	if (step) {
		step = parseInt(step, 10);
	}

	return function(error, iter) {
		if (error) {
			console.error(error);
			res.status(500);
			return;
		}

		var hs = {
			'Content-Type': 'application/json',
			'Cache-Control': NO_CACHE_CONTROL
		};
		if (etag) {
			hs.ETag = etag;
		}

		res.writeHead(200, hs);

		res.write('{"from":"' + from.toISOString() + '","dates":[');

		var lastImage;

		iter.next(function sendImage(error, next) {
			if (error) {
				console.error(error);
				res.end();
				return;
			}

			if (!next) {
				res.end(']}');
				return;
			}

			if (!step || !lastImage || (lastImage.imageDate + step > next.imageDate)) {
				writeItemFunc(next, !lastImage);

				lastImage = next;

				size--;
				if (!size) {
					res.end(']}');
					return;
				}
			}
			iter.next(sendImage);
		});
	};
}

app.get("/from/:from", function(req, res) {

	var fromDate = req.params.from;
	if (!fromDate) {
		res.status(404).send("Invalid from parameter");
		return;
	}

	if (fromDate.indexOf('T') < 0) {
		fromDate = parseInt(fromDate, 10);
	}

	var from = new Date(fromDate);

	moviesRepository.listImages(from, returnList(from, moviesRepository.getStateId(), req, res, function(item, first) {

		var str = '\"' + (new Date(item.imageDate)).toISOString() + '\"';
		if (first) {
			res.write(str);
			return;
		}

		res.write(',' + str);
	}));
});

app.get("/movies/:from", function(req, res) {

	var fromDate = req.params.from;
	if (!fromDate) {
		res.status(404).send("Invalid from parameter");
		return;
	}

	if (fromDate.indexOf('T') < 0) {
		fromDate = parseInt(fromDate, 10);
	}

	var from = new Date(fromDate);

	moviesRepository.listMovies(from, returnList(from, moviesRepository.getStateId(), req, res, function(item, first) {

		var str = '{"start":"' + (new Date(item.imageDate)).toISOString() + '","end":"' +
				(new Date(item.frames[item.frames.length - 1])).toISOString() + '","frames":' + item.frames.length + '}';
		if (first) {
			res.write(str);
			return;
		}

		res.write(',' + str);
	}));
});

app.get("/lastMovies", function(req, res) {
	var offset = (req.query.offset && parseInt(req.query.offset)) || 0;

	var size = (req.query.size && parseInt(req.query.size)) || LAST_MOVIES_MAX_SIZE;
	if (size <= 0 || !size || size > LAST_MOVIES_MAX_SIZE) {
		size = LAST_MOVIES_MAX_SIZE;
	}

	if (offset > 0) {
		size += offset;
	}

	var curStateId = moviesRepository.getStateId();
	var reqStateId = req.headers['if-none-match'];
	if (reqStateId === curStateId) {
		res.status(404).send("Not modified");
		return;
	}

	var first = true;
	var index = 0;
	var from = new Date();
	moviesRepository.lastMovies(size, returnList(from, curStateId, req, res, function(item) {

		// console.error(item);
		if (index++ < offset) {
			return;
		}

		var str = '{"start":"' + (new Date(item.imageDate)).toISOString() + '","end":"' +
				(new Date(item.frames[item.frames.length - 1])).toISOString() + '","frames":' + item.frames.length + '}';
		if (first) {
			res.write(str);
			first = false;
			return;
		}

		res.write(',' + str);
	}));
});

app.use(express.static(__dirname + '/pages'));

app.listen(program.httpPort || 8080);

