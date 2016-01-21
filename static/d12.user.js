// ==UserScript==
// @name         D12 turn checker for slack
// @namespace    https://hubot-gregcochard.rhcloud.com/hubot
// @updateURL    https://hubot-gregcochard.rhcloud.com/hubot/d12.user.js
// @version      1.0.27
// @description  calls hubot with the current player and other features
// @author       Greg Cochard
// @match        http://dominating12.com/game/*
// @match        http://www.dominating12.com//game/*
// @match        https://dominating12.com/game/*
// @match        https://www.dominating12.com//game/*
// @grant        none
// ==/UserScript==
/*global $: false, playGame: true, _: false*/
/*eslint-env browser*/
/*eslint no-console: 0*/
var users = {
    gcochard: 'greg'
    , greg: 'gcochard'
    , kwren: 'kwren'
    , ryanbmilbourne: 'ryan'
    , ryan: 'ryanbmilbourne'
    , jobratt: 'jobratt'
    , mmacfreier: 'mmacfreier'
    , justinb: 'justin'
    , justin: 'justinb'
    , loneWolf55: 'channel'
    , suntan: 'tanleach1001'
    , tanleach1001: 'suntan'
}, players = [], playerColors = {}, playerPollInterval, treatyPollInterval;

// inject lodash
var s = document.createElement('script');
s.id = 'lodash';
s.src = 'https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.0.0/lodash.min.js';
s.type = 'text/javascript';
s.async = true;
s.onload = loaded;

function loaded(){
    console.log('injected!');
    s.onLoad = null;

    function signalToHubot(player,ended){
        'use strict';
        if(!users[player]){
            return;
        }

        setTimeout(function(){
            $.ajax({
                url: 'https://hubot-gregcochard.rhcloud.com/hubot/pushturn',
                method: 'GET',
                success: function(){
                    console.log(arguments);
                },
                failure: function(){
                    console.error(arguments);
                },
                data: {
                    user: users[player],
                    ended: ended
                }
            });
        },100);
    }

    function reportDeaths(deaths){
        $.ajax({
            url: 'https://hubot-gregcochard.rhcloud.com/hubot/pushdeath',
            method: 'POST',
            success: function(){
                console.log(arguments);
            },
            failure: function(){
                console.error(arguments);
            },
            data: {
                deaths: deaths
            }
        });
    }

    function fetchTreaties(cb){
        'use strict';
        var called = false;
        $.ajax({
            url: 'https://hubot-gregcochard.rhcloud.com/hubot/treaties',
            method: 'GET',
            success: function(data){
                if(called){ return; }
                called = true;
                cb(null, data);
            },
            failure: function(e){
                if(called) { return; }
                called = true;
                cb(e);
            }
        });
    }

    function showTreatyError(err){
        'use strict';
        console.log(err);
        /*
        var treatyErr = err.statusText;
        if(!Ext.get('game-invites')){
            // we are piggy-backing on the game-invites container here...
            Ext.DomHelper.append('body', {tag: 'ul', id: 'game-invites'});
        }
        if(!Ext.get('treaty-error')){
            Ext.DomHelper.append('game-invites', {tag: 'li', id: 'treaty-error', html: treatyErr});
        } else if(Ext.get('treaty-error')[0].innerHTML !== treatyErr) {
            Ext.get('treaty-error').update(treatyHtml);
        }
        */
    }

    // inject our treaty container
    var $treaties = $('#notifications').clone().attr({id:'treaties',class:'treaties notifications'});
    $('#notifications').parent().append($treaties);
    $('ul.nav-list.pull-left').append('<li id="toggle-treaties">Toggle Treaties</li>');
    $('#toggle-treaties').on('click',function(){
        $treaties.toggle();
    });

    function showTreaties(data){
        'use strict';
        //console.log(data);
        var newTreatyIds = [];
        var oldTreatyIds = $('#treaties').find('li').map(function(i,t){
            return $(t).attr('id');
        });
        Object.keys(data).forEach(function(id){
            var t = data[id];
            var partnersWithColors = t.partners.map(function(p){
                var text = '<b style="color:'+playerColors[users[p.toLowerCase()]]+';">'+p+'</b>';
                return text;
            });
            newTreatyIds.push('treaty-'+t.id);
            // build out the treaty html
            var treatyHtml = (t.partners.length === 1 ? '<i>PENDING:</i> ':'') + 'Treaty ' + t.id + ': ' +t.terms + '<hr>' + partnersWithColors.join(', ');
            // if it doesn't exist, append it, otherwise update it
            if(!$treaties.find('#treaty-'+t.id).length){
                $treaties.append($(document.createElement('li')).attr({tag: 'li', class: 'treaty', id: 'treaty-'+ t.id}).html(treatyHtml));
            } else {
                $('#treaty-'+t.id).html(treatyHtml);
            }
        });
        var expiredTreaties = _.difference(oldTreatyIds,newTreatyIds);
        expiredTreaties.forEach(function(id){
            var $el = $('#'+id);
            $el.fadeOut(function(){
                $el.remove();
            });
        });
        return;
    }

    var reqs = 0;
    function pollTreaties(){
        'use strict';
        // only want one outstanding request
        if(reqs){ return; }
        reqs++;
        fetchTreaties(function(err,data){
            reqs--;
            if(err){
                console.log(err);
                showTreatyError(err);
                return;
            }
            showTreaties(data);
            return;
        });
    }

    function queueDice(p, a, d){
        var q = window.localStorage.getItem('diceQueue');
        if(q){
            q = JSON.parse(q);
        } else {
            q = {p:'',a:0,d:0};
        }
        q.p = p;
        q.a += a;
        q.d += d;
        window.localStorage.setItem('diceQueue',JSON.stringify(q));
    }

    function getQueue(){
        var q = window.localStorage.getItem('diceQueue');
        if(q){
            q = JSON.parse(q);
            window.localStorage.clear();
            return q;
        }
        return null;
    }

    function sendDiceToHubot(player, attack, defend){
        $.ajax({
            url: 'https://hubot-gregcochard.rhcloud.com/hubot/pushdice',
            method: 'POST',
            success: function(){
                var q = getQueue();
                if(q){
                    sendDiceToHubot(q.p,q.a,q.d);
                }
            },
            failure: function(){
                queueDice(player, attack, defend);
            },
            data: {
                player: player,
                attack: attack,
                defend: defend
            }
        });
    }
    //var hidden = false;
    $(document).ready(function(){
        'use strict';
        /*
        var oldRemoveInvites = window.removeInvites;
        window.removeInvites = function(){
            if(Ext.get('game-invites')){
                Ext.DomQuery.select('[id^=invite-]').remove();
            }
        };
        */
        
        var oldShowDice = playGame.showDice;
        playGame.showDice = function(att,att_color,def,def_color){
            sendDiceToHubot(getPlayer(),att,def);
            return oldShowDice.call(this,att,att_color,def,def_color);
        };

        var oldRunUpdates = playGame.runUpdates;
        playGame.runUpdates = function(result){
            if(result.winner){
                signalToHubot(result.winner.names.join(', '), true);
                clearInterval(playerPollInterval);
                clearInterval(treatyPollInterval);
            }
            return oldRunUpdates.call(this,result);
        };
        var currDead = [];
        var oldUpdatePlayers = playGame.updatePlayerlist;
        playGame.updatePlayerlist = function(players){
            var newDead = [];
            // clone the object
            Object.keys(players).forEach(function(p){ newDead.push(players[p]); });
            // filter out alives
            newDead = newDead.filter(function(p){ return !p.alive; });
            // now translate to slack usernames
            newDead = newDead.map(function(p){ return users[p.username]; });
            if(currDead.length !== newDead.length){
                // save it...
                currDead = newDead;
                // report the deaths...
                reportDeaths(currDead);
            }
            // ...and finally call the original method
            return oldUpdatePlayers.call(this,players);
        };

    /*
        setTimeout(function(){
            Ext.DomHelper.append('uPanel-info', {tag: 'span', id: 'separator', html: ' | '});
            Ext.DomHelper.append('uPanel-info', {tag: 'a', id: 'toggle-treaty', html: 'toggle treaties'});
            Ext.EventManager.on('toggle-treaty', 'click', function() {
                hidden = !hidden;
                Ext.get('game-invites').toggle();
            });
        }, 2000);
    */
        var curPlayer;

        function getPlayer(){
            players = $('tr > .name > a');
            players = players.map(function(idx,v){
                var $v = $(v);
                // set the color of the player
                var node = $v.parent().parent().children(':last').children(':last').children(':last');
                playerColors[$v.html()] = node.text().toLowerCase();
                return $v.html();
            });
            if(!players.length){
                return;
            }
            var newPlayer = $('td.turn').parent().find('.name > a');
            if(!newPlayer){
                return;
            }
            newPlayer = newPlayer.html();
            return newPlayer;
        }
        setTimeout(function(){
            var oldShowNotification = playGame.showNotificationBanner;
            playGame.showNotificationBanner = function(color, message){
                switch(message){
                case 'Turn finished.':
                    pollPlayer();
                    break;
                }
                return oldShowNotification.apply(this,Array.prototype.slice.call(arguments));
            };
        },2000);
        function pollPlayer(){
            var newPlayer = getPlayer();
            if(!curPlayer){
                curPlayer = newPlayer;
                signalToHubot(curPlayer);
            }
            if(curPlayer && newPlayer && curPlayer !== newPlayer){
                curPlayer = newPlayer;
                signalToHubot(curPlayer);
            }
        }
        pollPlayer();
        // fallback to polling at 300s interval if change detection doesn't work
        playerPollInterval = setInterval(pollPlayer,300000);
        
        setTimeout(pollTreaties,2000);
        // poll treaties at a 15 second interval
        treatyPollInterval = setInterval(pollTreaties,15000);
    });

}
document.getElementsByTagName('head')[0].appendChild(s);
