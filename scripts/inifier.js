// Description:
//   replace in with :in:
//   replace g with :goog:
//   replace 100 with :100:

/*eslint-env node*/
'use strict';

const percentage = .01;
const replacements = [ 'in', ['g','goog'], '100' ];

module.exports = function(robot){
  // todo: Make this one function that hears all patterns and replaces all instances
  replacements.forEach(function(r){
    var v = r;
    if(r instanceof Array){
      r = r[0];
      v = v[1];
    }
    const hear = new RegExp(`.*(?!:)${r}(?!:).*`), re = new RegExp(`(.?)${r}(.?)`,'g'), rep = `$1:${v}:$2`;
    robot.hear(hear, function(msg){
        if(/Pssst! I didn.t unfurl /.test(msg)){
            return;
        }
        if(Math.random() > percentage){
            return;
        }
        var replaced = msg.match[0].replace(re, rep);
        return msg.reply(`did you mean "${replaced}"?`);
    });
  });
};
