var React = require('react');
var ReactDOM = require('react-dom');
var marked = require('marked');
var Redux = require('redux');
var ReactRedux = require('react-redux');
var $ = require('jquery');
var Chess = require('./chess.min.js').Chess;

var BoardStore = require('./assets/js/components/Board/BoardStore.js');

var Game = require('./assets/js/components/Game/Game.js');
var GameForm = require('./assets/js/components/GameForm/GameForm.js');

var token = window.location.href.split('/')[4];

if (token == null)
	token = "";

if (document.getElementById('game') != null)
	ReactDOM.render(
		<ReactRedux.Provider store={BoardStore}>
			<Game token={token}/>
		</ReactRedux.Provider>,
		document.getElementById('game')
	);

if (document.getElementById('gameform') != null)
	ReactDOM.render(
		<GameForm/>,
		document.getElementById('gameform')
	);