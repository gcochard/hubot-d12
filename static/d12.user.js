// ==UserScript==
// @name         D12 turn checker for slack
// @namespace    https://hubot-gregcochard.rhcloud.com/hubot
// @updateURL    https://hubot-gregcochard.rhcloud.com/hubot/d12.user.js
// @version      1.0.5
// @description  calls hubot with the current player
// @author       Greg Cochard
// @match        http://dominating12.com/?cmd=game&sec=play&id=*
// @match        http://dominating12.com/index.php?cmd=game&sec=play&id=*
// @match        http://www.dominating12.com/?cmd=game&sec=play&id=*
// @match        http://www.dominating12.com/index.php?cmd=game&sec=play&id=*
// @grant        none
// ==/UserScript==
/*global Ext: false*/
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
}, players = [], playerColors = {};

function signalToHubot(player){
    'use strict';
    if(!users[player]){
        return;
    }

    setTimeout(function(){
        Ext.Ajax.request({
            url: "https://hubot-gregcochard.rhcloud.com/hubot/pushturn",
            method: 'GET',
            success: console.log,
            failure: console.error,
            params: {
                user: users[player]
            }
        });
    },100);
}

function fetchTreaties(cb){
    'use strict';
    var called = false;
    Ext.Ajax.request({
        url: "https://hubot-gregcochard.rhcloud.com/hubot/treaties",
        method: 'GET',
        success: function(data){
            if(called){ return; }
            called = true;
            cb(null, JSON.parse(data.responseText));
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
}

function showTreaties(data){
    'use strict';
    Ext.get('game-invites') && Ext.get('game-invites').remove();
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
}

reqs = 0;
function pollTreaties(){
    'use strict';
    // only want one outstanding request
    if(reqs){ return; }
    reqs++;
    fetchTreaties(function(err,data){
        reqs--;
        if(err){
            console.log(err);
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
    Ext.Ajax.request({
        url: "https://hubot-gregcochard.rhcloud.com/hubot/pushdice",
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
        params: {
            player: player,
            attack: attack,
            defend: defend
        }
    });
}
function mapInt(n){
    return parseInt(n,10);
}
hidden = false;
Ext.onReady(function(){
    'use strict';
    var oldRemoveInvites = window.removeInvites;
    window.removeInvites = function(){
        if(Ext.get('game-invites')){
            Ext.DomQuery.select('[id^=invite-]').remove();
        }
    };
    
    var oldDisplayRoll = window.displayRoll;
    window.displayRoll = function(att,def){
        var currPlayer = Ext.DomQuery.select('tr:has(.isTurn):last > .name > a') || [];
        currPlayer = currPlayer[0] || {};
        currPlayer = currPlayer.innerHTML || '';
        att = att.map(mapInt);
        def = def.map(mapInt);
        sendDiceToHubot(currPlayer,att,def);
        oldDisplayRoll(att,def);
    };

    setTimeout(function(){
        Ext.DomHelper.append('uPanel-info', {tag: 'span', id: 'separator', html: ' | '});
        Ext.DomHelper.append('uPanel-info', {tag: 'a', id: 'toggle-treaty', html: 'toggle treaties'});
        Ext.EventManager.on('toggle-treaty', 'click', function() {
            hidden = !hidden;
            Ext.get('game-invites').toggle();
        });
    }, 2000);

    var curPlayer;
    function pollPlayer(){
        players = Ext.DomQuery.select('tr > .name > a');
        players = players.map(function(v){
            // set the color of the player
            var node = v.parentNode.parentNode.lastChild.lastChild;
            playerColors[v.innerHTML] = (node.textContent || node.innerText).toLowerCase();
            return v.innerHTML;
        });
        if(!players.length){
            return;
        }
        var newPlayer = Ext.DomQuery.select('tr:has(.isTurn):last > .name > a') || [];
        newPlayer = newPlayer[0] || {};
        newPlayer = newPlayer.innerHTML || '';
        if(!newPlayer){
            return;
        }
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
    setInterval(pollPlayer,2000);
    
    setTimeout(pollTreaties,2000);
    // poll treaties at a 15 second interval
    setInterval(pollTreaties,15000);
});
