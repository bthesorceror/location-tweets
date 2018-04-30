#!/usr/bin/env node

const start = require("../lib/main");
start()
  .then(() => {
    console.log("Ran successfully");
  })
  .catch(e => {
    console.error("an error occurred");
    console.error(e);
  });
