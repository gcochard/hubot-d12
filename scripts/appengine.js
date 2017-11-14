module.exports = function(robot){
  robot.router.post('/hubot/wake', function(req,res){
    return res.status(200).end();
  });
  return robot.router.get('/_ah/start', function(req,res){
    return res.status(200).end();
  });
};
