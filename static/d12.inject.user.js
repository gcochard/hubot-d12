// ==UserScript==
// @name         D12 turn checker for slack injector
// @namespace    https://hubot-gregcochard.rhcloud.com/hubot
// @updateURL    https://hubot-gregcochard.rhcloud.com/hubot/d12.inject.user.js
// @version      2.0.0
// @description  injects the real script so we can debug with firebug
// @author       Greg Cochard
// @match        http://dominating12.com/game/*
// @match        http://www.dominating12.com/game/*
// @match        https://dominating12.com/game/*
// @match        https://www.dominating12.com/game/*
// @match        http://dominating12.com/index.php/game/*
// @match        http://www.dominating12.com/index.php/game/*
// @match        https://dominating12.com/index.php/game/*
// @match        https://www.dominating12.com/index.php/game/*
// @grant        none
// ==/UserScript==
/*eslint-env browser*/

var e = document.createElement('script');
e.src = 'https://hubot-gregcochard.rhcloud.com/hubot/d12.user.js';
e.type = 'text/javascript';
document.getElementsByTagName('head')[0].appendChild(e);
