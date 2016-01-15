// ==UserScript==
// @name         D12 turn checker for slack
// @namespace    https://hubot-gregcochard.rhcloud.com/hubot
// @updateURL    https://hubot-gregcochard.rhcloud.com/hubot/d12.user.js
// @version      1.0.14
// @description  calls hubot with the current player and other features
// @author       Greg Cochard
// @match        http://dominating12.com/game/*
// @match        http://www.dominating12.com//game/*
// @match        https://dominating12.com/game/*
// @match        https://www.dominating12.com//game/*
// @grant        none
// ==/UserScript==
/*global $: false, playGame: true*/
/*eslint-env browser*/
/*eslint no-console: 0*/
console.log('injected!');
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

function fetchTreaties(cb){
    'use strict';
    var called = false;
    $.ajax({
        url: 'https://hubot-gregcochard.rhcloud.com/hubot/treaties',
        method: 'GET',
        success: function(data){
            if(called){ return; }
            called = true;
            cb(null, data.responseText);
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

function showTreaties(data){
    'use strict';
    console.log(data);
    return;
    /*
    Ext && Ext.get('game-invites') && Ext.get('game-invites').remove();
    // we are piggy-backing on the game-invites container here...
    Ext.DomHelper.append('body', {tag: 'ul', id: 'game-invites'});
    if(hidden){
        Ext.get('game-invites').toggle();
    }

    Ext.get('treaty-error') && Ext.get('treaty-error').remove();
    Object.keys(data).forEach(function(id){
        var t = data[id];
        var partnersWithColors = t.partners.map(function(p){
            var text = '<b style="color:'+playerColors[users[p.toLowerCase()]]+';">'+p+'</b>';
            return text;
        });
        // build out the treaty html
        var treatyHtml = (t.partners.length === 1 ? '<i>PENDING:</i> ':'') + 'Treaty ' + id + ': ' +t.terms + '<hr>' + partnersWithColors.join(', ');
        Ext.DomHelper.append('game-invites', {tag: 'li', id: 'treaty-'+ id, html: treatyHtml});
    });
    */
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
    // fallback to polling at 20s interval if change detection doesn't work
    playerPollInterval = setInterval(pollPlayer,20000);
    
    setTimeout(pollTreaties,2000);
    // poll treaties at a 15 second interval
    treatyPollInterval = setInterval(pollTreaties,15000);
});

