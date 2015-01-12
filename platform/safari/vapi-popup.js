var whenSizeChanges = function(elm, callback) {
    var reset = function() {
        k.style.width = grow.offsetWidth + 10 + "px";
        k.style.height = grow.offsetHeight + 10 + "px";
        grow.scrollLeft = grow.scrollWidth;
        grow.scrollTop = grow.scrollHeight;
        shrink.scrollLeft = shrink.scrollWidth;
        shrink.scrollTop = shrink.scrollHeight;
        w = elm.offsetWidth;
        h = elm.offsetHeight;
    }
    var aux = document.createElement("div");
    aux.style.cssText = "position:absolute;left:0;top:0;right:0;bottom:0;overflow:scroll;z-index:-1;visibility:hidden";
    aux.innerHTML = '<div style="position:absolute;left:0;top:0;right:0;bottom:0;overflow:scroll;z-index:-1;visibility:hidden">\
<div style="position:absolute;left:0;top:0;"></div>\
</div>\
<div style="position:absolute;left:0;top:0;right:0;bottom:0;overflow:scroll;z-index:-1;visibility:hidden">\
<div style="position:absolute;left:0;top:0;width:200%;height:200%"></div>\
</div>';
    elm.appendChild(aux);
    var grow = aux.childNodes[0],
        k = grow.childNodes[0],
        shrink = aux.childNodes[1];
    var w, h;
    reset();
    grow.addEventListener("scroll", function() {
        (elm.offsetWidth > w || elm.offsetHeight > h) && callback();
        reset();
    });
    shrink.addEventListener("scroll", function() {
        (elm.offsetWidth < w || elm.offsetHeight < h) && callback();
        reset();
    });
};
var onLoaded = function() {
    var body = document.body, popover = safari.self;
    var updateSize = function() {
        popover.width = body.clientWidth;
        popover.height = body.clientHeight;
    };
    body.style.position = "relative"; // Necessary for size change detection
    whenSizeChanges(body, updateSize);
};
window.addEventListener('load', onLoaded);
