"use strict";

const path = require("node:path");
const { writeBuildIdentity } = require("../build-identity");
// electron-builder hook only. Adding this hook does not build a package.
module.exports = async context => {
  const appRoot = context.packager.info.appDir;
  writeBuildIdentity(appRoot, path.resolve(appRoot, "../../.."));
};
