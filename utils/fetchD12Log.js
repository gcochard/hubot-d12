/*eslint-env node*/

'use strict'

var cheerio = require('cheerio')
  , _ = require('underscore')
  , request = require('request')
  , util = require('util')

// D12 uses non-standard times.  We'll use these to make a Date() out of D12 timestamps
// They use a date string, so here's a quick enum
var months = {
    'Jan': 0
  , 'Feb': 1
  , 'Mar': 2
  , 'Apr': 3
  , 'May': 4
  , 'Jun': 5
  , 'Jul': 6
  , 'Aug': 7
  , 'Sep': 8
  , 'Oct': 9
  , 'Nov': 10
  , 'Dec': 11
}

// For parsing their funky timestamp format
var tsReggy = /(\d{2})\s([A-Za-z]{3}),\s(\d{2}):(\d{2}):(\d{2})\s(am|pm)/i

// Message patterns.  Used to determine the player committing the action
var logPatterns = {
    gameStart: /Game\sstarted/
  , roundStart: /Round\s+(\d+)\s+started/
  , startTurn: /(\w+)\sstarted\sthe\sturn/
  , endTurn: /(\w+)\sended\sthe\sturn/
  , joined: /(\w+)\sjoined\sthe\sgame/
  , missed: /(\w+)\smissed\sthe\sturn/
  , defeated: /(\w+)\s+was\sdefeated/
  , received: /(\w+)\s+received/
  , attacked: /\s\((\w+)\)\s+attacked/
  , occupied: /\s\((\w+)\)\s+occupied/
  , reinforced: /\s\((\w+)\)\s+was\sreinforced/
  , fortified: /\s\((\w+)\)\s+was\sfortified/
  , wonGame: /(\w+)\swon\sthe\sgame/
  , lost: /(\w+)\slost/
}

/**
 * @callback parseLogCb
 * @param {Object} err - Error object or null
 * @param {Object} log - Log object, with all of that pesky html removed
 */

/**
 * Makes sense of those silly html-ified D12 logs
 * @param {Object} log - Log property returned from https://dominating12.com/game/<gameID>/play/load-full-log
 * @param {parseLogCb} cb - Callback to handle the response
 */
var parseLog = function(log, cb){
    if(!log || typeof log !== 'object'){
        return cb(new Error('invalid log'))
    }

    // Year? D12 doesn't do years
    var year = new Date(Date.now()).getFullYear()

    var round = 0 // Round 1 starts when game starts
    log = _.map(log, function(entry){
        // De-html-ify
        var $ = cheerio.load(entry)
          , logMsg = $('.chat-message-body').text().trim()
          , logTs = $('.chat-message-time').text().trim()

        // Take the d12 timestamp and create a Date that we'll use to get ISO
        var tsMatch = tsReggy.exec(logTs)
        var hr = tsMatch[6] === 'am' ? tsMatch[3] : Number(tsMatch[3])+12
        var dt = new Date(Date.UTC(year, months[tsMatch[2]], tsMatch[1], hr, tsMatch[4], tsMatch[5]))

        // Figure the round and player who triggered the event
        var player = 'unknown'
        _.some(logPatterns, function(pattern, key){
            var match = pattern.exec(logMsg)
            if(!match){
                return false
            }
            if(key === 'roundStart' || key === 'gameStart'){
                round++
                return true
            }
            player = match[1]
            return true
        })

        return {
            message: logMsg
          , timestamp: dt.toISOString()
          , player: player
          , round: round
        }
    })
    return cb(null, log)
}

/**
 * @callback fetchLogCb
 * @param {Object} err - Error object or null
 * @param {Object} log - Log object, keyed by event number
 */

/** 
 * Fetches a given game's log and parses the output into a tidy object.
 * @param {Number} gameId - ID of game whose log we want
 * @param {fetchLogCb} cb - Callback to handle the response
 */ 
var fetchLog = function(gameId, cb){
    if(!gameId || typeof gameId !== 'number'){
        return cb(new Error('gameId must be a number'))
    }
    if(gameId < 1){
        return cb(new Error('gameId must be a positive number'))
    }
    var route = util.format('https://dominating12.com/game/%s/play/load-full-log', gameId)
    request.post({
        url: route
      , form: {
            before: 99999999
        }
    }, function(err, res, body){
        var data
        if(err || res.statusCode !== 200){
            return cb(err || new Error('non-200 status code: '+res.statusCode))
        }
        try{
            data = JSON.parse(body)
            parseLog(data.log, cb)
        } catch (e){
            return cb(new Error('error parsing game log: '+e))
        }
    })
}


module.exports = fetchLog
/**** Quick example
var gameId = 629530
fetchLog(gameId, function(err, data){
    if(err){
        console.dir(err)
        process.exit(1)
    }
    var round = 0
    _.each(data, function(entry, seq){
        console.log('%s -> %s', seq, util.inspect(entry))
    })
})
*/
