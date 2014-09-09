var app = angular.module('moviesApp', []);

app.controller('MoviesCtrl', [ '$scope', '$http', '$timeout', function MoviesCtrl($scope, $http, $timeout) {

	$scope.movies = [];

	$scope.init = function() {
		$scope.loadMovies();

	};

	$scope.loadMovies = function() {
		var httpRequest = $http({
			url: '/lastMovies?size=16'

		}).success(function(data, status) {
			if (data.dates) {
				if (!$scope.movies[0] || !data.dates || $scope.movies[0].start !== data.dates[0].start) {
					$scope.movies = data.dates;
				}
			}

			$timeout($scope.loadMovies, 1000 * 30);
		});

	};

	function nextImage(div, movie, current, frames) {

		if (!movie.loading) {
			loadImg(div, "/get/" + (new Date(movie.start)).toISOString());
			$scope.$digest();
			return;
		}

		if (!frames.length) {
			$http({
				url: '/from/' + (new Date(current + 1)).toISOString()

			}).success(function(data, status) {
				if (data && data.dates && data.dates.length) {
					frames.push.apply(frames, data.dates);

					$timeout(nextImage.bind($scope, div, movie, current, frames), 0, false);
					return;
				}

				// console.log("No more images");

				movie.loading = false;
				loadImg(div, "/get/" + (new Date(movie.start)).toISOString());
			});

			return;
		}

		var date = new Date(frames.shift());

		// console.log("Date=" + date);

		if (date.getTime() - $scope.movieStart > $scope.movieRunning) {
			// console.log("END");
			movie.loading = false;
			$scope.$digest();

			loadImg(div, "/get/" + (new Date($scope.currentMovie.start)).toISOString());
			return;
		}

		var newLoadingStage = Math.floor((date.getTime() - $scope.movieStart) / $scope.movieRunning * 100);
		if (Math.floor(movie.loadingStage) < Math.floor(newLoadingStage)) {
			$scope.$apply(function() {
				movie.loadingStage = Math.floor((date.getTime() - $scope.movieStart) / $scope.movieRunning * 100);
			});
		}

		var dt = date.getTime() - $scope.movieStart + $scope.showStart - Date.now();

		// console.log("dt=" + dt);

		if (dt <= 10) {
			loadImg(div, "/get/" + date.toISOString());
			$timeout(nextImage.bind($scope, div, movie, +date, frames), 20, false);
			return;
		}

		$timeout(function() {
			loadImg(div, "/get/" + date.toISOString());
			$timeout(nextImage.bind($scope, div, movie, +date, frames), 20, false);
		}, dt, false);
	}

	$scope.showMovie = function(event, movie) {
		var div = event.currentTarget;

		var timeoutPromise = $scope.timeoutPromise;
		if (timeoutPromise) {
			$scope.timeoutPromise = undefined;
			$timeout.cancel(timeoutPromise);
		}

		if ($scope.currentMovie) {
			$scope.currentMovie.loading = false;
		}

		$scope.showStart = Date.now();
		$scope.movieRunning = +new Date(movie.end) - new Date(movie.start);
		$scope.movieStart = +new Date(movie.start);
		$scope.currentMovie = movie;
		movie.loading = true;
		movie.loadingStage = 0;

		// console.log("Start=" + $scope.showStart + " Running=" +
		// $scope.movieRunning + " MStart=" + $scope.movieStart);

		$scope.timeoutPromise = $timeout(nextImage.bind($scope, div, movie, $scope.movieStart, []), 20, false);
	};

	function loadImg(div, src) {
		if (div.loadingImage) {
			div.loadingNextImage = src;
			return;
		}
		div.loadingImage = true;
		div.loadingNextImage = null;

		var old = div._lastImage;
		if (!old) {
			old = div.querySelector("IMG");
		}

		var img = div.ownerDocument.createElement("IMG");
		div._lastImage = img;

		var is = img.style;
		is.border = "0";
		is.position = "absolute";
		is.left = "-10000px";
		is.top = "-10000px";
		img.className = "movieImage";

		img.src = src;
		img.onload = function() {
			div.loadingImage = false;
			is.left = "0";
			is.top = "0";

			if (old) {
				setTimeout(function() {
					old.style.display = "none";

					div.removeChild(old);

					is.position = "static";
				}, 20);
			}
			var next = div.loadingNextImage;
			if (next) {
				div.loadingNextImage = null;

				loadImg(div, next);
			}

		};
		div.insertBefore(img, div.firstChild);
	}

} ]);

var DAYS = [ "Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam" ];

app.filter('dateFormat', function() {
	return function(date) {
		var d = new Date(date);
		var t = d.getTime();
		var nowT = Date.now();

		var diff = nowT - t;
		if (diff < 1000 * 60) {
			return "Maintenant";
		}

		diff = Math.floor(diff / 1000 * 60);

		if (diff < 60) {
			return diff + " mn";
		}

		var hr = d.getHours();
		var mn = d.getMinutes();

		if (diff < 60 * 24) {
			return ((hr < 10) ? "0" : "") + hr + ":" + ((mn < 10) ? "0" : "") + mn;
		}

		if (diff < 60 * 24 * 7) {
			return DAYS[d.getDay()] + ((hr < 10) ? "0" : "") + hr + ":" + ((mn < 10) ? "0" : "") + mn;
		}

		var dt = d.getDate();
		var mo = d.getMonth() + 1;

		return DAYS[d.getDay()] + " " + ((dt < 10) ? "0" : "") + dt + "/" + ((mo < 10) ? "0" : "") + mo;
	};
});

app.filter('runtime', function() {
	return function(movie) {
		var start = +new Date(movie.start);
		var end = +new Date(movie.end);

		end -= start;

		if (end < 1000 * 60) {
			var s = Math.floor(end / 1000);
			return s + " seconde" + ((s >= 2) ? "s" : "");
		}

		var mn = Math.floor(end / (1000 * 60)) + "mn";
		var ss = Math.floor(end / 1000) % 60;
		if (ss) {
			mn += " " + ss + "s";
		}

		return mn;
	};
});

app.filter('add2Seconds', function() {
	return function(date) {
		var d = new Date(date);

		d.setSeconds(d.getSeconds() + 2);

		return d.toISOString();
	};
});