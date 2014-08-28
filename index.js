var IPCamera = require('node-ipcamera');
var http = require('http');
var cv = require('opencv');
var program = require('commander');
var fs = require('fs');
var path = require('path');

program.option("-u, --url <url>", "Mjpeg stream URL");

program.option("-d, --detectionLevel <level>", "Detection level", parseFloat);

program.option("-p, --storePath <path>", "Store path");

program.parse(process.argv);

if (!program.url) {
	throw new Error("URL parameter must be specified");
}

if (!program.storePath) {
	throw new Error("StorePath parameter must be specified");
}

var multipartStream = new IPCamera.MultipartMjpegDecoderStream();

var stddev = program.detectionLevel || 5;
var cnt = 0;

var prevFrame;
var currentFrame;
var nextFrame;

var d1 = new cv.Matrix();
var d2 = new cv.Matrix();
var motion = new cv.Matrix();

var frames = [];
var recordTo = 0;
var recordStream = 0;
var maxImages = 0;

function processImage(jpeg, saved) {

	var now = Date.now();

	if (saved) {
		// Nothing

	} else if (recordStream && recordTo > now) {
		console.error("record image");
		recordStream.writeJpeg(jpeg, function(error) {
			if (error) {
				console.error(error);
			}

			processImage(jpeg, true);
		});
		return;

	} else {
		recordTo = 0;

		for (; frames.length;) {
			if (frames[0].date.getTime() > now - 2000) {
				break;
			}

			if (recordStream) {
				console.error("Close stream");
				recordStream.close();
				recordStream = null;
			}

			frames.shift();
		}

		frames.push(jpeg);
	}

	if (frames.length > maxImages) {
		maxImages = frames.length;
		console.error(maxImages + " images in memory");
	}

	cv.readImage(jpeg.data, function(err, mat) {
		if (err) {
			console.error(err);
			return;
		}

		mat.convertGrayscale();

		prevFrame = currentFrame;
		currentFrame = nextFrame;
		nextFrame = mat;

		if (!prevFrame || !currentFrame || !nextFrame) {
			multipartStream.once('jpeg', processImage);
			return;
		}

		d1.absDiff(prevFrame, nextFrame);
		d2.absDiff(nextFrame, currentFrame);
		motion.bitwiseAnd(d1, d2);
		motion.threshold(35, 255);
		motion.erode(1);

		var dev = motion.meanStdDev();
		var stddev = dev.stddev.get(0, 0);
		console.error("Deviation=", stddev);
		if (stddev < stddev) {
			multipartStream.once('jpeg', processImage);
			return;
		}

		recordTo = now + 2000;

		console.error("Record to " + recordTo);

		if (recordStream) {
			multipartStream.once('jpeg', processImage);
			return;
		}

		if (!recordStream) {
			var date = jpeg.date;
			var mn = date.getMonth() + 1;
			var md = date.getDate();
			var mh = date.getHours();
			var mi = date.getMinutes();
			var ms = date.getSeconds();

			var p = path.join(program.storePath, "Image " + date.getFullYear() + "-" + ((mn < 10) ? "0" : "") + mn + "-" +
					((md < 10) ? "0" : "") + md + " " + ((mh < 10) ? "0" : "") + mh + "-" + ((mi < 10) ? "0" : "") + mi + "-" +
					((ms < 10) ? "0" : "") + ms + ".mjpeg");

			var fsStream = fs.createWriteStream(p);
			recordStream = new IPCamera.MultipartMjpegEncoderStream({}, fsStream);
		}

		var imgs = frames;
		frames = [];

		function writeNext(error) {
			if (error) {
				console.error(error);
				imgs = [];
			}
			if (!imgs.length) {
				multipartStream.once('jpeg', processImage);
				return;
			}

			recordStream.writeJpeg(imgs.shift(), writeNext);
		}

		writeNext();

	});
}

multipartStream.once('jpeg', processImage);

var request = http.request(program.url, function(response) {

	if (response.statusCode !== 200) {
		throw new Error("Invalid status code of response " + response.statusCode);
	}

	response.pipe(multipartStream);
});

request.end();
