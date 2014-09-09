var app = angular.module('moviesApp', []);

app.controller('MoviesCtrl', [ '$scope', '$http', '$timeout', function MoviesCtrl($scope, $http, $timeout) {

	$scope.movies = [];

	$scope.init = function() {
		$scope.loadMovies();
	};

	$scope.loadMovies = function() {
		var httpRequest = $http({
			url: '/lastMovies'

		}).success(function(data, status) {
			if (data.dates) {
				$scope.movies = data.dates;
			}
		});

	};

	function nextImage(div, current, frames) {

		if (!frames.length) {
			$http({
				url: '/from/' + (new Date(current + 1)).toISOString()

			}).success(function(data, status) {
				if (data && data.dates && data.dates.length) {
					frames.push.apply(frames, data.dates);

					nextImage(div, current, frames);
					return;
				}

				console.log("No more images");

			});

			return;
		}

		var date = new Date(frames.shift());

		console.log("Date=" + date);

		if (date.getTime() - $scope.movieStart > $scope.movieRunning) {
			console.log("END");
			return;
		}

		var dt = date.getTime() - $scope.movieStart + $scope.showStart - Date.now();

		console.log("dt=" + dt);

		if (dt <= 10) {
			loadImg(div, "/get/" + date.toISOString());
			$timeout(nextImage.bind($scope, div, +date, frames), 20, false);
			return;
		}

		$timeout(function() {
			loadImg(div, "/get/" + date.toISOString());
			$timeout(nextImage.bind($scope, div, +date, frames), 20, false);
		}, dt, false);
	}

	$scope.showMovie = function(event, movie) {
		var div = event.currentTarget;

		var timeoutPromise = $scope.timeoutPromise;
		if (timeoutPromise) {
			$scope.timeoutPromise = undefined;
			$timeout.cancel(timeoutPromise);
		}

		$scope.showStart = Date.now();
		$scope.movieRunning = +new Date(movie.end) - new Date(movie.start);
		$scope.movieStart = +new Date(movie.start);

		console.log("Start=" + $scope.showStart + " Running=" + $scope.movieRunning + " MStart=" + $scope.movieStart);

		$scope.timeoutPromise = $timeout(nextImage.bind($scope, div, $scope.movieStart, []), 20, false);
	};

	function loadImg(div, src) {
		if (div.loadingImage) {
			div.loadingImage = src;
			return;
		}
		div.loadingImage = src;

		var img = div.ownerDocument.createElement("IMG");
		var is = img.style;
		is.border = "0";
		is.position = "absolute";
		is.left = "0";
		is.top = "0";
		img.className = "movieImage";

		img.src = src;
		img.onload = function() {
			div.loadingImage = null;

			if (div.childNodes.length > 1) {
				setTimeout(function() {
					div.firstChild.style.display = "none";

					div.removeChild(div.firstChild);

					is.position = "static";
				}, 20);
			}

		};
		div.appendChild(img);
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

		if (diff < 60 * 24) {
			var hr = d.getHours();
			var mn = d.getMinutes();

			return ((hr < 10) ? "0" : "") + hr + ":" + ((mn < 10) ? "0" : "") + mn;
		}

		if (diff < 60 * 24 * 7) {
			return DAYS[d.getDay()];
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