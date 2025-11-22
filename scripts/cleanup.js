// scripts/cleanup.js
const fs = require('fs');

try {
  fs.unlinkSync('tmp-contract-addresses.json');
  console.log('Temporary address file removed');
} catch (err) {
  console.log('No temporary file to remove');
}