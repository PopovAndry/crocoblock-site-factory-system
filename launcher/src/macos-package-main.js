"use strict";

const { runPackageCli } = require("./windows-package-main");

if (require.main === module) {
  runPackageCli().catch(() => {
    process.stderr.write("Crocoblock Site Factory could not start. Open System Check for details.\n");
    process.exitCode = 1;
  });
}

module.exports = { runPackageCli };
