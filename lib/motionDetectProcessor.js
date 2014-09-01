var cv = require('opencv');
var Events = require('events');
var Util = require('util');

function MotionDetectProcessor(configuration) {
	configuration = configuration || {};
	this._configuration = configuration;

	this._stddevLevel = configuration.detectionLevel || 2.5;
	this._thresholdLevel = configuration.thresholdLevel || 35;
	this._erodeIteration = configuration.erodeIteration || 2;

	this._d1 = new cv.Matrix();
	this._d2 = new cv.Matrix();
	this._motion = new cv.Matrix();
}

Util.inherits(MotionDetectProcessor, Events.EventEmitter);
module.exports = MotionDetectProcessor;

var proto = {

	processImage: function(jpeg, callback) {

		var self = this;

		cv.readImage(jpeg, function(err, mat) {
			if (err) {
				return callback(err);
			}

			mat.convertGrayscale();

			self._prevFrame = self._currentFrame;
			self._currentFrame = self._nextFrame;
			self._nextFrame = mat;

			var prevFrame = self._prevFrame;
			var currentFrame = self._currentFrame;
			var nextFrame = self._nextFrame;

			if (!prevFrame || !currentFrame || !nextFrame) {
				return callback(null, false);
			}

			var d1 = self._d1;
			var d2 = self._d2;
			var motion = self._motion;

			d1.absDiff(prevFrame, nextFrame);
			d2.absDiff(nextFrame, currentFrame);
			motion.bitwiseAnd(d1, d2);
			motion.threshold(self._thresholdLevel, 255);
			motion.erode(self._erodeIteration);

			var meanStdDev = motion.meanStdDev();
			var stddev = meanStdDev.stddev.get(0, 0);

			var detected = (stddev >= self._stddevLevel);

			self.emit('computations', {
				d1: d1,
				d2: d2,
				motion: motion,
				meanStdDev: meanStdDev,
				stddev: stddev,
				detected: detected
			});

			return callback(null, detected);
		});
	}
};

for ( var i in proto) {
	MotionDetectProcessor.prototype[i] = proto[i];
}
