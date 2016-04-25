var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var morgan = require('morgan');
var bodyParser = require('body-parser');
var sassMiddleware = require('node-sass-middleware');
var Immutable = require('immutable');

var Map = Immutable.Map;
var List = Immutable.List;

var Timer = require('./app/assets/js/lib/timer');
var Chess = require('./app/assets/js/lib/chess.min.js').Chess;

var hostname = 'localhost';
var port = 8080;

var srcPath = __dirname;
var destPath = __dirname;

app.set('views', __dirname + '/views/pages');
app.set('view engine', 'jade');

app.use(morgan('dev'));
app.use(sassMiddleware({
	src: srcPath,
	dest: destPath,
	debug: true,
	force: true,
	outputStyle: 'expanded'
}));

app.get('/', function (req, res, next) {
	res.render('index', {
		title: 'Home'
	});
});

app.get('/play/:id', function (req, res, next) {
	res.render('play', {
		title: 'Play'
	});
});

var games = Map();
var players = Map();

io.on('connection', function (socket) {
	console.log('a user has connected', socket.id);
	socket.on('disconnect', function () {
		console.log('a user disconnected');
		if (players.get(socket.id) == null)
			return;
		
		var token = players.get(socket.id);
		
		if (games.get(token) == null)
			return;
		
		games = games.updateIn([token, 'white'], function (players) {
			for (var i = 0; i < players.size; i++) {
				if (players.get(i).id == socket.id) {
					players = players.delete(i);
					break;
				}
			}
			return players;
		});
		
		games = games.updateIn([token, 'black'], function (players) {
			for (var i = 0; i < players.size; i++) {
				if (players.get(i).id == socket.id) {
					players = players.delete(i);
					break;
				}
			}
			return players;
		});
		
		var white = []
		var black = []
		
		for (var i = 0; i < games.getIn([token, 'white']).size; i++)
			white.push(games.getIn([token, 'white']).get(i).id);
		for (var i = 0; i < games.getIn([token, 'black']).size; i++)
			black.push(games.getIn([token, 'black']).get(i).id);
		
		console.log("Room update emitted",token);
		io.to(token).emit('room:update', {
			white: white,
			black: black
		});
		
		if (games.getIn([token, 'creator']) != null && games.getIn([token, 'creator']).id == socket.id) {
			games = games.updateIn([token, 'blackTimers'], function (list) {
				for (var i = 0; i < list.size; i++)
					list.get(i).stop();
				return list;
			});
			
			games = games.updateIn([token, 'whiteTimers'], function (list) {
				for (var i = 0; i < list.size; i++)
					list.get(i).stop();
				return list;
			});
			
			games = games.delete(token);
			io.to(token).emit('token:invalid');
		}
		
		players.delete(socket.id);
	});
	
	socket.on('game:timeUpdate', function (data) {
		io.to(data.token).emit('game:timeUpdate', {
			whiteTimes: data.whiteTimes
		});
	});
	
	socket.on('game:move', function (data) {
		console.log("BOARD MOVED", data.from, data.to, data.color);
		
		var piece = null;
		var color = null;
		
		if (games.getIn([data.token, 'boards', data.boardNum]).get(data.to) != null) {
			piece = games.getIn([data.token, 'boards', data.boardNum]).get(data.to).type;
			color = games.getIn([data.token, 'boards', data.boardNum]).turn();
		}
		
		var san = games.getIn([data.token, 'boards', data.boardNum]).move({
			from: data.from,
			to: data.to,
			promotion: 'q'
		}).san;

		io.to(data.token).emit('game:move', {
			from: data.from,
			to: data.to,
			boardNum: data.boardNum,
			fen: games.getIn([data.token, 'boards', data.boardNum]).fen(),
			piece: piece,
			color: color,
			san: san
		});
		
		if (data.color == 'b') {
			games.getIn([data.token, 'whiteTimers', data.boardNum]).start();
			games.getIn([data.token, 'blackTimers', data.boardNum]).stop();
		} else if (data.color == 'w') {
			games.getIn([data.token, 'blackTimers', data.boardNum]).start();
			games.getIn([data.token, 'whiteTimers', data.boardNum]).stop();
		}
	});
	
	socket.on('game:place', function (data) {
		console.log("BOARD PLACED", data.piece, data.pos, data.color);
		
		games = games.updateIn([data.token, 'boards', data.boardNum], function (board) {
			board.put({type: data.piece, color: data.color}, data.pos);
			var tokens = board.fen().split(" ");
			tokens[1] = data.color == 'b' ? 'w' : 'b';
			board = new Chess(tokens.join(" "));
			return board;
		});
		
		var san = data.piece + "@" + data.pos;
		if (games.getIn([data.token, 'boards', data.boardNum]).in_check())
			san += '+';
		
		io.to(data.token).emit('game:place', {
			piece: data.piece,
			color: data.color,
			boardNum: data.boardNum,
			fen: games.getIn([data.token, 'boards', data.boardNum]).fen(),
			san: san
		});
		
		if (data.color == 'b') {
			games.getIn([data.token, 'whiteTimers', data.boardNum]).start();
			games.getIn([data.token, 'blackTimers', data.boardNum]).stop();
		} else if (data.color == 'w') {
			games.getIn([data.token, 'blackTimers', data.boardNum]).start();
			games.getIn([data.token, 'whiteTimers', data.boardNum]).stop();
		}
	});
	
	socket.on('game:end', function (data) {
		console.log(data.token, data.boardNum)
		if (games.getIn([data.token, 'whiteTimers', data.boardNum]) != null)
			games.getIn([data.token, 'whiteTimers', data.boardNum]).stop();
		if (games.getIn([data.token, 'blackTimers', data.boardNum]) != null)
			games.getIn([data.token, 'blackTimers', data.boardNum]).stop();
	});
	
	socket.on('game:start', function (data) {
		
		var numOfBoards = games.getIn([data.token, 'white']).size;
		
		var game = games.get(data.token);
		var time = game.get('time');
		var inc = game.get('inc');
		
		for (var i = 0; i < game.get('white').size; i++) {
			game.get('white').get(i).emit('game:start', {
				boardNum: i, 
				numOfBoards: numOfBoards,
				time: time,
				inc: inc
			});
			game.get('black').get(i).emit('game:start', {
				boardNum: i, 
				numOfBoards: numOfBoards,
				time: time,
				inc: inc
			});
			
			games = games.updateIn([data.token, 'whiteTimers'], function (list) {
				list = list.push(new Timer(time, inc, i, function (time, boardNum) {
					io.to(data.token).emit('game:timeupdate', {
						boardNum: boardNum,
						color: 'w',
						time: time
					});
				}, function (boardNum) {
					io.to(data.token).emit('game:timeout', {
						boardNum: boardNum,
						color: 'w'
					});
				}));
				return list;
			});
			
			games = games.updateIn([data.token, 'blackTimers'], function (list) {
				list = list.push(new Timer(time, inc, i, function (time, boardNum) {
					io.to(data.token).emit('game:timeupdate', {
						boardNum: boardNum,
						color: 'b',
						time: time
					});
				}, function (boardNum) {
					io.to(data.token).emit('game:timeout', {
						boardNum: boardNum,
						color: 'b'
					});
				}));
				return list;
			});
			
			games = games.updateIn([data.token, 'boards'], function (list) {
				list = list.push(new Chess());
				return list;
			});
		}
		
		clearTimeout(games.getIn([data.token, 'timeout']));
	});
	
	socket.on('room:create', function (data) {
		console.log("Created room", data.token);

		var timeout = setTimeout(function () {
			console.log("TOKEN IS INVALID NOW");
			games = games.delete(data.token);
			io.to(data.token).emit('token:invalid');
		}, 60 * 1000 * 20);
		
		games = games.set(data.token, Map({
			creator: null,
			time: data.time,
			inc: data.inc,
			roomSize: data.teamSize * 2,
			white: List(),
			black: List(),
			whiteTimers: List(),
			blackTimers: List(),
			boards: List(),
			timeout: timeout
		}));
		
		socket.emit('room:created', {token: data.token});
	});
	
	socket.on('room:join', function (data) {
		console.log("joining room", data.token);
		var game = games.get(data.token);
		
		if (!game) {
			socket.emit('token:invalid');
			return;
		}

		var playerCnt = game.get('white').size + game.get('black').size;
		
		console.log("PLAYERCNT", playerCnt, "ROOM SIZE", game.get('roomSize'))
		
		if (playerCnt >= game.get('roomSize')) {
			console.log("Room is full");
			socket.emit('room:full');
			return;
		}
		
		console.log("Actually joining with socket");
		socket.join(data.token);
		players = players.set(socket.id, data.token);
		
		games = games.updateIn([data.token, 'creator'], function (s) {
			if (s == null)
				s = socket;
			return s;
		});
		
		console.log("Updating players");
		games = games.updateIn([data.token, 'white'], function (players) {
			players = players.push(socket);
			return players;
		});
		
		console.log("Emitting a room enter", games.getIn([data.token, 'creator']).id);
		socket.emit('room:enter', {
			creatorId: games.getIn([data.token, 'creator']).id,
			userId: socket.id
		});
		
		var white = []
		var black = []
		
		for (var i = 0; i < games.getIn([data.token, 'white']).size; i++)
			white.push(games.getIn([data.token, 'white']).get(i).id);
		
		for (var i = 0; i < games.getIn([data.token, 'black']).size; i++)
			black.push(games.getIn([data.token, 'black']).get(i).id);
		
		io.to(data.token).emit('room:update', {
			white: white,
			black: black
		});
	});
	
	socket.on('room:update', function (data) {
		var socketToAdd;
		games = games.updateIn([data.token, 'white'], function (players) {
			for (var i = 0; i < players.size; i++) {
				if (players.get(i).id == data.userId) {
					socketToAdd = players.get(i);
					players = players.delete(i);
				}
			}
			return players;
		});
		
		games = games.updateIn([data.token, 'black'], function (players) {
			for (var i = 0; i < players.size; i++) {
				if (players.get(i).id == data.userId) {
					socketToAdd = players.get(i);
					players = players.delete(i);
				}
			}
			return players;
		});

		games = games.updateIn([data.token, data.newColor], function (players) {
			players = players.push(socketToAdd);
			return players;
		});
		
		var white = []
		var black = []
		
		for (var i = 0; i < games.getIn([data.token, 'white']).size; i++)
			white.push(games.getIn([data.token, 'white']).get(i).id);
		for (var i = 0; i < games.getIn([data.token, 'black']).size; i++)
			black.push(games.getIn([data.token, 'black']).get(i).id);
		
		io.to(data.token).emit('room:update', {
			white: white,
			black: black
		});
	});
});

app.use("/", express.static(__dirname + '/'));

http.listen(port, function () {
	console.log("Server is running at http://" + hostname + "/" + port);
});