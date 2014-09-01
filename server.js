var express = require('express');
var program = require('commander');
var Async = require('async');
var fs = require('fs');
var Path = require('path');
var MjpegScanner = require('./lib/mjpegScanner');
var RBTree = require('bintrees').RBTree;

var NO_CACHE_CONTROL = "no-cache, private, no-store, must-revalidate, max-stale=0, max-age=1,post-check=0, pre-check=0";

var MAX_SIZE = 128;

program.option("--httpPort <port>", "HttpPort", parseInt);

program.option("--storePath <path>", "Store path");

program.parse(process.argv);

if (!program.storePath) {
	throw new Error("storePath parameter must be specified");
}
var app = express();

var filesTree = new RBTree(function(img1, img2) {
	return img1.imageDate - img2.imageDate;
});

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

	var image = filesTree.find({
		imageDate: date.getTime()
	});
	if (!image) {
		res.status(404).send("Invalid image not found");
		return;
	}

	fs.open(image.path, "r", function(error, fd) {
		if (error) {
			console.error(error);

			res.status(505);
			return;
		}

		res.writeHead(200, {
			'Content-Type': 'image/jpeg',
			'Content-Length': String(image.bodyLength),
			'X-Image-Date': (new Date(image.imageDate)).toISOString()
		});

		var buf = new Buffer(1024 * 16);
		var pos = image.bodyOffset;
		var size = image.bodyLength;

		function writeBuf() {
			fs.read(fd, buf, 0, Math.min(buf.length, size), pos, function(error, byteRead) {
				if (error) {
					console.error(error);

					res.end();
					fs.close(fd);
					return;
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
						return;
					}

					// console.log("Write " + byteRead + " bytes");

					pos += byteRead;
					size -= byteRead;

					if (size <= 0) {
						res.end();
						fs.close(fd);
						return;
					}

					writeBuf();
				});
			});
		}

		writeBuf();
	});

});

app.get("/from/:from", function(req, res) {

	var fromDate = req.params.from;
	if (!fromDate) {
		res.status(404).send("Invalid from parameter");
		return;
	}
	var size = req.query.size || MAX_SIZE;
	if (size <= 0 || !size || size > MAX_SIZE) {
		size = MAX_SIZE;
	}
	var step = req.query.step;
	if (step) {
		step = parseInt(step, 10);
	}

	res.writeHead(200, {
		'Content-Type': 'application/json',
		'Cache-Control': NO_CACHE_CONTROL
	});

	if (fromDate.indexOf('T') < 0) {
		fromDate = parseInt(fromDate, 10);
	}

	var from = new Date(fromDate);

	var iter = filesTree.upperBound({
		imageDate: from.getTime() - 1
	});

	res.write('{"start":"' + from.toISOString() + '","dates":[');

	var lastImage;
	for (; size > 0;) {
		var next = iter.next();
		if (!next) {
			break;
		}

		if (step && lastImage && lastImage.imageDate + step > next.imageDate) {
			continue;
		}

		if (!lastImage) {
			res.write('\"' + (new Date(next.imageDate)).toISOString() + '\"');
		} else {
			res.write(',\"' + (new Date(next.imageDate)).toISOString() + '\"');
		}

		lastImage = next;

		size--;
	}

	res.end(']}');
});

app.listen(program.httpPort || 8080);

function scan(directory, callback) {

	listDirectoryContents(directory, directory, [], function(error, files) {
		if (error) {
			return callback(error);
		}

		console.log(files.length + " detected files");

		var cnt = 0;
		Async.eachLimit(files, 4, function(item, callback) {
			var scanner = new MjpegScanner(item);
			cnt++;

			function nextFrame() {
				scanner.nextFrameInfos(function(error, properties) {
					if (error) {
						return callback(error);
					}
					if (!properties) {
						return scanner.close(callback);
					}

					console.log("Add image " + filesTree.size + " " + cnt + "/" + files.length);

					filesTree.insert(properties);

					setImmediate(nextFrame);
				});
			}

			nextFrame();

		}, function(error) {
			if (error) {
				return callback(error);
			}

			console.log(filesTree.size + " referenced images.");
		});
	});
}

function listDirectoryContents(rootPath, path, list, callback) {

	fs.readdir(path, function(error, files) {
		Async.each(files, function(file, callback) {
			var p = Path.join(path, file);

			fs.lstat(p, function(error, stats) {
				if (error) {
					console.error("LStat " + p + " error", error);
					return callback(error);
				}

				if (stats.isDirectory()) {
					return listDirectoryContents(rootPath, p, list, callback);
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
}

if (program.storePath) {
	scan(program.storePath, function(error) {
		if (error) {
			console.error("Scan error ", error);
			return;
		}
	});
}
