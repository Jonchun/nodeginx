var fs = require('fs');
var async = require('async');
var exec = require('child_process').exec;
var mustache = require('mustache');

// TODO: account for alternate install locations
// http://nginx.org/en/docs/beginners_guide.html
// nginx may be installed in /usr/local/nginx/conf, /etc/nginx, or
// /usr/local/etc/nginx.

// nginx constants
const NGINX_PATH = '/etc/nginx/';
const sitesAvailableStr = 'sites-available';
const sitesEnabledStr = 'sites-enabled';

module.exports = {
  manageNginx: manageNginx,
  toggleSites: toggleSites,
  removeSite: removeSite,
  addSite: addSite,
  constants: {
    NGINX_PATH: NGINX_PATH,
    sitesAvailableStr: sitesAvailableStr,
    sitesEnabledStr: sitesEnabledStr
  }
};

// Utility
function xorleft (array0, array1){
  return array0.filter(array0element=>{
    return !array1.some(array1element=>{
      return array1element === array0element;
    });
  });
}

function fileExists(filepath){
  fs.stat(filepath, (err, stats)=>{
    return Boolean(stats);
  });
}

function sudoRemove(filepath, callback) {
  // Would prefer `fs.unlink` but, I don't know how to make it work with sudo
  exec(`sudo rm ${filepath}`, (err, stdout, stderr)=>{
    if(err) return callback(err);
    console.log(stdout, stderr);
    callback();
  });
}

function sudoMove(filepath, dest, mvBool, callback) {
  // Would prefer `fs.writeFile` but sudo
  var mvORcp = mvBool ? 'mv' : 'cp';
  var cmd = `sudo ${mvORcp} ${filepath} ${dest}`;
  exec(cmd, (err, stdout, stderr)=>{
    if(err) return callback(err);
    console.log(stdout, stderr);
    callback();
  });
}

// Nginx process functions
function manageNginx(action, callback) {
  // TODO: research if sending signals is better
  // i.e. sudo nginx -s stop|quit|reload
  exec(`sudo service nginx ${action}`, (err, stdout, stderr)=>{
    if(err){
      console.log(`failed to $(action) nginx`);
      return callback(err);
    }
    console.log(`${action}ed nginx`);
    return callback();
  });
}

// Toggle site function and helpers
function enableSite (site, callback){
  // would prefer `fs.symlink` but, sudo
  var availablePath = `${NGINX_PATH}${sitesAvailableStr}/${site}`;
  var enabledPath = `${NGINX_PATH}${sitesEnabledStr}/${site}`;
  var cmd = `sudo ln -s ${availablePath} ${enabledPath}`;

  exec(cmd, (err, stdout, stderr)=>{
    if(err) return callback(err);
    console.log(`enable ${site}`, stdout, stderr);
    callback();
  });
}

function disableSite (site, callback){
  sudoRemove(`${NGINX_PATH}${sitesEnabledStr}/${site}`, (err)=>{
    if(err) return callback(err);
    console.log(`disabled ${site}`);
    callback();
  });
}

function toggleSites (sitesEnabled, askToggleSiteAnswers, toggleDoneCB){
  async.series([
    // enable sites
    (callback)=>{
      async.eachSeries(xorleft(askToggleSiteAnswers, sitesEnabled),enableSite,
        callback);
    },
    // disable sites
    (callback)=>{
      async.eachSeries(xorleft(sitesEnabled, askToggleSiteAnswers),disableSite,
        callback);
    },
    // reload nginx configuration
    (callback)=>{
      manageNginx('reload', callback);
    }
  ], (err)=>{
    if (err) {
      return toggleDoneCB(err);
    }
    toggleDoneCB();
  });
}

// Add and remove virtual host file
function addSite (addSiteObj, callback){
  var addSiteAns = addSiteObj.askAddSite.toLowerCase();
  if (addSiteAns.indexOf('template') > 0){
    var tplFilePath = (addSiteAns.indexOf('static') > 0) ?
      `${__dirname}/templates/static` :
      `${__dirname}/templates/proxy`;

    fs.readFile(tplFilePath, 'utf8', (err, tmpl)=>{
      if (err) return callback(err);
      var config = mustache.render(tmpl, addSiteObj);
      var site = addSiteObj.tplServerName;
      var tempfilepath = `${__dirname}/${site}`;
      var sitesAvailable = `${NGINX_PATH}${sitesAvailableStr}/`;

      console.log(`${site} config file will be added to ${sitesAvailableStr}`);
      fs.writeFile(tempfilepath, config, (err)=>{
        if(err) return callback(err);
        sudoMove(tempfilepath, sitesAvailable, true, callback);
      });
    });
  }else{
    var usrTplFilePath = addSiteObj.askAddSiteConfig;
    var sitesAvailable = `${NGINX_PATH}${sitesAvailableStr}/`;

    sudoMove(usrTplFilePath, sitesAvailable, false, callback);
    return callback();
  }
}

function removeSite (site, removeSiteDoneCB){
  // if the file is currently enabled, disable it before removing it.
  async.series([
    (callback)=>{
      if(fileExists(`${NGINX_PATH}${sitesEnabledStr}/${site}`)){
        disableSite(site, callback);
      }else{
        return callback();
      }
    }, (callback)=>{
      sudoRemove(`${NGINX_PATH}${sitesAvailableStr}/${site}`, (err)=>{
        if(err) return callback(err);
        console.log(`${site} removed`);
        return callback();
      });
    }, (callback)=>{
      manageNginx('reload', callback);
    }
  ], (err)=>{
    if(err) return removeSiteDoneCB(err);
    return removeSiteDoneCB();
  });
}
