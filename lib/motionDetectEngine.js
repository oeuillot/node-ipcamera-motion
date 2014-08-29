var IPCamera = require('node-ipcamera');
var MotionDetectProcessor = require('./motionDetectProcessor');
var cv = require('opencv');
var fs = require('fs');
var path = require('path');
var Events = require('events');
var Util = require('util');

function MotionDetectEngine(configuration, jpegEventEmitter) {
	configuration = configuration || {};
	this._configuration = configuration;

	this._jpegEventEmitter = jpegEventEmitter;

	this._imageDelayMs = configuration.detectionFPS && (Math.floor(1000 / (configuration.detectionFPS || 25)));
	this._frames = [];
	this._recordTo = 0;
	this._recordStream = 0;
	this._maxImages = 0;
	this._lastImageDate = 0;

	this._processor = new MotionDetectProcessor(configuration);

	if (configuration.showDeviation) {
		this._processor.on("computations", function(results) {
			var dsl = new Date();
			process.stdout.write(dsl.toISOString() + " Deviation=" + results.stddev + "  " +
					(self._recordStream ? '(RECORDING)' : '') + "          \r");

			if (results.detected || self._recordStream) {
				process.stdout.write("\n");
			}
		});
	}

	jpegEventEmitter.once('jpeg', this._processImage.bind(this));
}

Util.inherits(MotionDetectEngine, Events.EventEmitter);
module.exports = MotionDetectEngine;

var proto = {
	_createPath: function(date) {
		var basePath = this._configuration.basePath;
		var prefix = this._configuration.mjpegPrefix || "Movie ";
		var suffix = this._configuration.mjpegSuffix || ".mjpeg";

		var mn = date.getMonth() + 1;
		var md = date.getDate();
		var mh = date.getHours();
		var mi = date.getMinutes();
		var ms = date.getSeconds();

		var p = path.join(basePath, String(date.getFullYear()));
		try {
			fs.statSync(p);
		} catch (x) {
			if (x.code === 'ENOENT') {
				fs.mkdirSync(p);
			} else {
				console.log(x);
				throw x;
			}
		}

		p = path.join(p, ((mn < 10) ? "0" : "") + mn);
		try {
			fs.statSync(p);
		} catch (x) {
			if (x.code === 'ENOENT') {
				fs.mkdirSync(p);
			} else {
				console.log(x);
				throw x;
			}
		}

		p = path.join(p, ((md < 10) ? "0" : "") + md);
		try {
			fs.statSync(p);
		} catch (x) {
			if (x.code === 'ENOENT') {
				fs.mkdirSync(p);
			} else {
				console.log(x);
				throw x;
			}
		}

		if (false) {
			p = path.join(p, ((mh < 10) ? "0" : "") + mh);
			try {
				fs.statSync(p);
			} catch (x) {
				if (x.code === 'ENOENT') {
					fs.mkdirSync(p);
				} else {
					console.log(x);
					throw x;
				}
			}
		}

		p = path.join(p, prefix + date.getFullYear() + "-" + ((mn < 10) ? "0" : "") + mn + "-" + ((md < 10) ? "0" : "") +
				md + " " + ((mh < 10) ? "0" : "") + mh + "-" + ((mi < 10) ? "0" : "") + mi + "-" + ((ms < 10) ? "0" : "") + ms +
				suffix);

		return p;
	},

	_processImage: function(jpeg) {

		var now = Date.now();
		var frames = this._frames;

		if (this._recordStream && this._recordTo + 500 >= now) {
			this._recordStream.pushJpeg(jpeg);

		} else {
			this._recordTo = 0;

			for (; frames.length;) {
				if (frames[0].date.getTime() > now - 2000) {
					break;
				}

				var recordStream = this._recordStream;
				if (recordStream) {
					this._recordStream = null;

					// console.error("Close stream");
					recordStream.close();

					this.emit('detected', {
						path: this._streamPath
					});
				}

				frames.shift();
			}

			frames.push(jpeg);
		}

		if (frames.length > this._maxImages) {
			this._maxImages = frames.length;
			console.error(this._maxImages + " images in memory");
		}

		var self = this;
		function onceNextJpeg() {
			self._jpegEventEmitter.once('jpeg', self._processImage.bind(self));
		}

		if (this._imageDelayMs && this._lastImageDate + this._imageDelayMs > now) {
			// console.error("Skip frame");
			return onceNextJpeg();
		}

		this._lastImageDate = now;
		// console.error("Process frame");

		this._processor.processImage(jpeg.data, function(error, detected) {
			if (error) {
				console.error(error);
				return;
			}

			if (!detected) {
				return onceNextJpeg();
			}

			self._recordTo = now + 2500;

			var recordStream = self._recordStream;
			if (recordStream) {
				for (; frames.length;) {
					recordStream.pushJpeg(frames.shift());
				}

				return onceNextJpeg();
			}

			var p = self._createPath(jpeg.date);
			self._streamPath = p;

			var fsStream = fs.createWriteStream(p);
			recordStream = new IPCamera.MultipartMjpegEncoderStream({}, fsStream);
			self._recordStream = recordStream;

			self.emit('detecting', {
				path: p,
				jpeg: jpeg,
				timestamp: now
			});

			for (; frames.length;) {
				recordStream.pushJpeg(frames.shift());
			}

			onceNextJpeg();
		});
	}
};

for ( var i in proto) {
	MotionDetectEngine.prototype[i] = proto[i];
}
