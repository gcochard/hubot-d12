// ==UserScript==
// @name         D12 turn checker for slack injector
// @namespace    http://hubot-gregcochard.rhcloud.com/hubot
// @updateURL    http://hubot-gregcochard.rhcloud.com/hubot/d12.inject.user.js
// @version      1.0.0
// @description  injects the real script so we can debug with firebug
// @author       Greg Cochard
// @match        http://dominating12.com/?cmd=game&sec=play&id=*
// @match        http://dominating12.com/index.php?cmd=game&sec=play&id=*
// @match        http://www.dominating12.com/?cmd=game&sec=play&id=*
// @match        http://www.dominating12.com/index.php?cmd=game&sec=play&id=*
// @grant        none
// ==/UserScript==
/*global Ext: false*/

var e = document.createElement("script");
e.src = "http://hubot-gregcochard.rhcloud.com/hubot/d12.user.js";
e.type = "text/javascript";
document.getElementsByTagName("head")[0].appendChild(e);
