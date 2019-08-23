const profileDir = process.argv[2]
if (!profileDir || profileDir.length < 1) {
  console.error("no profile dir given");
  process.exit(1);
}

const localStateFilePath = `${profileDir}/Local State`;
const _ = require('lodash');
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));

function getModifyFunction(disable) {
  if (disable === true) {
    return profile => {
      console.log('disable');
      try {
         _.remove(profile.browser["enabled_labs_experiments"], el => el === "autoplay-policy@1")
      } catch (e) {}
      return  profile;
    }
  } else {
    return profile =>
        _.merge(profile, {
          browser: {
            "enabled_labs_experiments": ["autoplay-policy@1"]
          }
        })
  }
}


function readModifyWrite(jsonFilePath, modFunction) {
  return fs.readFileAsync(jsonFilePath, 'utf8')
      .then(data => JSON.parse(data))
      .then(profile => modFunction(profile))
      .then(profile => fs.writeFileAsync(jsonFilePath, JSON.stringify(profile)))
}


readModifyWrite(localStateFilePath,  getModifyFunction(process.argv[3] === '--disable-autoplay'))
    .catch(err => {
      console.error("Something bad happened", err);
      process.exit(1);
    });
