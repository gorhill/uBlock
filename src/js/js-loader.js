(function() {
	document.body.style.display = "none";
	document.addEventListener("DOMContentLoaded", function onDOMReady(e) {
		document.removeEventListener(e.type, onDOMReady, false);

		var jsListToLoad = document.querySelector("script[data-jsList]");

		if (jsListToLoad) {
			jsListToLoad = jsListToLoad.getAttribute("data-jsList").trim().split(/\s+/);
		}

		if (Array.isArray(jsListToLoad)) {
			var loadNextJSFile = function() {
				var script, src = jsListToLoad.shift();

				if (src) {
					script = document.createElement("script");
					script.onload = function() {
						this.onload = null;

						if (jsListToLoad.length) {
							loadNextJSFile();
						}
						else {
							document.body.style.display = "";
							jsListToLoad = document.querySelector("script[data-jsList]");
							jsListToLoad.parentNode.removeChild(jsListToLoad);
						}
					};
					document.body.appendChild(script).src = src;
				}
			};

			loadNextJSFile();
		}
	}, false);
})();