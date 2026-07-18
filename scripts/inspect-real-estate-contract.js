"use strict";

const { evaluateRealEstateContract } = require("../launcher/src/real-estate-contract");

function flagValue(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? null : argv[index + 1] || null;
}

try {
  const report = evaluateRealEstateContract({
    slug: flagValue(process.argv, "--slug"),
    projectsRoot: flagValue(process.argv, "--projects-root")
  });
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exitCode = report.status === "compliant" ? 0 : 1;
} catch (error) {
  process.stderr.write("Real Estate contract inspection could not complete.\n");
  process.exitCode = 1;
}
