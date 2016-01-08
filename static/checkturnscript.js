// ==UserScript==
// @name         Turn Check Webhook for slack
// @namespace    https://hubot.gregcochard.com/hubot
// @updateURL    https://hubot.gregcochard.com/hubot/checkturnscript.user.js
// @version      1.0.0
// @description  calls hubot to check turn order on-demand
// @author       Greg Cochard
// @match        http://gamesbyemail.com/Games/Play*
// @grant        none
// ==/UserScript==
/*eslint-env browser*/
/*global jQ:false, GamesByEmail:true*/
'use strict';
function addJQuery(callback) {
    var script = document.createElement("script");
    script.setAttribute("src", "//ajax.googleapis.com/ajax/libs/jquery/1/jquery.min.js");
    script.addEventListener('load', function() {
        var s = document.createElement("script");
        s.textContent = "window.jQ=jQuery.noConflict(true);(" + callback.toString() + ")();";
        document.body.appendChild(s);
    }, false);
    document.body.appendChild(script);
}
function main(){
    jQ(document).ready(function($){
        setTimeout(function replacer(){
            function clickAndCheck(proxyfn){
                return function(){
                    proxyfn.apply(this,arguments);
                    // wait 1 second before firing the request off to hubot
                    setTimeout(function(){
                        $.ajax({
                            type: "GET",
                            url: "http://hubot.gregcochard.com/hubot/checkturn",
                            dataType: "text",
                            success: function () {}
                        });
                    },1000);
                };
            }
            if(GamesByEmail && GamesByEmail.GambitGame && GamesByEmail.GambitGame.prototype.doneButtonClicked){
                GamesByEmail.GambitGame.prototype.doneButtonClicked = clickAndCheck(GamesByEmail.GambitGame.prototype.doneButtonClicked);
                GamesByEmail.GambitGame.prototype.done1ButtonClicked = clickAndCheck(GamesByEmail.GambitGame.prototype.done1ButtonClicked);
                console.log('doneButtonClicked and done1ButtonClicked replaced');
            } else {
                setTimeout(replacer,1000);
            }
        },1000);

        setTimeout(function fairRoller(){
            function realRandom(h,l){
                if (arguments.length<2){
                    l=0;
                }
                var d=h-l+1;
                var RAND_MAX = Math.pow(2,16)-1;
                var RAND_EXCESS = (RAND_MAX % d) + 1;
                var RAND_LIMIT = RAND_MAX - RAND_EXCESS;
                var actualRandom = new Uint16Array(1), rand;
                do{
                    window.crypto.getRandomValues(actualRandom);
                    rand = actualRandom[0];
                } while(rand > RAND_LIMIT);

                return rand%d+l;
            }
            if(GamesByEmail && GamesByEmail.random){
                GamesByEmail.random = realRandom;
            } else {
                setTimeout(fairRoller,1000);
            }
        },1000);
    });
}
addJQuery(main);
