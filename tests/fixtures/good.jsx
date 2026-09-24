#target illustrator
(function () {
  var rng = {};
  rng["float"] = function (min, max) { return min + (max - min) * Math.random(); };
  var meta = {"float": true, "int": true};
  if (meta["float"]) rng["float"](0, 1);
}());
