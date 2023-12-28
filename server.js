const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const mysql = require('mysql');
let currentHighScore = 0;

// MySQL 연결 정보
const connection = mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: 'jy122385@',
    database: 'game_data'
});

// MySQL 연결
connection.connect((err) => {
    if (err) {
        console.error('MySQL connection error: ' + err.stack);
        return;
    }

    console.log('Connected to MySQL as id ' + connection.threadId);
});

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.get('/', (req, res) => {
    res.send('Hello, this is your Express server!');
});

const highScoreQuery = 'SELECT MAX(Score) as highscore FROM score_data';

connection.query(highScoreQuery, (error, results, fields) => {
    if (error) {
        console.error('MySQL에서 최고 점수 가져오는 중 오류 발생: ' + error.stack);
    } else {
        currentHighScore = results.length > 0 ? results[0].highscore : 0;
    }
});

wss.on('connection', (client) => {
    console.log('Client connected');

    client.on('message', function mss(message) {
        const parsedMessage = JSON.parse(message);
        console.log('client: %s', parsedMessage.type);

        if (parsedMessage.type === 'SaveScore') {
            SaveScore(parsedMessage.UserID, parsedMessage.Score, parsedMessage.Playtime);
        }
        else if (parsedMessage.type === "GetScoreList") {
            const query = 'SELECT Score as score, ID as id, DENSE_RANK() OVER (ORDER BY Score DESC) rank FROM score_data';

            connection.query(query, (error, results, fields) => {
                if (error) {
                    console.error('Error fetching data from MySQL: ' + error.stack);
                    return;
                }

                const scoreList = [];
                const idList = [];
                const rankList = [];

                for (let i = 0; i < 12 && i < results.length; i++) {
                    scoreList.push(results[i].score);
                    idList.push(results[i].id);
                    rankList.push(results[i].rank);
                }
                client.send(JSON.stringify({ scores: scoreList, users: idList, rank: rankList, type: "ScoreList" }));
            });
        }
        else if (parsedMessage.type === "GetHighScore") {
            const query = 'SELECT MAX(Score) as highscore FROM score_data';

            connection.query(query, (error, results, fields) => {
                if (error) {
                    console.error('Error fetching high score from MySQL: ' + error.stack);
                } else {
                    // 결과가 있을 때 최고 점수를 콜백 함수로 전달
                    const highScore = results.length > 0 ? results[0].highscore : 0;
                    client.send(JSON.stringify({ highScore: highScore, type: "HighScore" }));
                }
            });
        }
        else if (parsedMessage.type === "GetBestScore") {
            const query = 'SELECT MAX(Score) as bestscore FROM score_data WHERE ID = \'' + parsedMessage.UserID + '\'';

            connection.query(query, (error, results, fields) => {
                if (error) {
                    console.error('Error fetching best score from MySQL: ' + error.stack);
                } else {
                    // 결과가 있을 때 최고 점수를 콜백 함수로 전달
                    const bestScore = results.length > 0 ? results[0].bestscore : 0;
                    client.send(JSON.stringify({ bestScore: bestScore, type: "BestScore" }));
                }
            });
        }
        else if (parsedMessage.type === "SignIn" || parsedMessage.type === "SignUp") {
            const userID = parsedMessage.UserID;
            const userPW = parsedMessage.UserPW;
            const type = parsedMessage.type;

            let query = 'SELECT ID as userid, PW as userpw FROM login_data';

            connection.query(query, (error, results, fields) => {
                if (error) {
                    console.error('Error SignIn to MySQL: ' + error.stack);
                    return;
                }

                const userExists = results.some(result => result.userid === userID);

                if (type === "SignIn") {
                    if (userExists) {
                        const user = results.find(result => result.userid === userID);
                        if (userPW === user.userpw) {
                            console.log('User signed in successfully!');
                            client.send(JSON.stringify({ result: true, type: "SignIn" }));
                        } else {
                            console.log('Incorrect password for the given user.');
                            client.send(JSON.stringify({ result: false, type: "SignIn" }));
                        }
                    } else {
                        console.log('User not found.');
                        client.send(JSON.stringify({ result: false, type: "SignIn" }));
                    }
                } else if (type === 'SignUp') {
                    if (userExists) {
                        console.log('User already exists.');
                        client.send(JSON.stringify({ result: false, type: "SignUp" }));
                    } else {
                        query = 'INSERT INTO login_data (ID, PW) VALUES (?, ?)';
                        connection.query(query, [userID, userPW], (error, results, fields) => {
                            if (error) {
                                console.error('Error saving score to MySQL: ' + error.stack);
                                client.send(JSON.stringify({ result: false, type: "SignUp" }));
                            } else {
                                console.log('User signed up and saved to MySQL!');
                                client.send(JSON.stringify({ result: true, type: "SignUp" }));
                            }
                        });
                    }
                }
            });
        }
    });
});
server.listen(1337, () => {
    console.log('Server opened on port 1337.');
});
function SaveScore(userID, score, Playtime) {
    // MySQL에 스코어 저장 쿼리
    let query = 'INSERT INTO score_data (ID, Score) VALUES (?, ?)';

    connection.query(query, [userID, score], (error, results, fields) => {
        if (error) {
            console.error('Error saving score to MySQL: ' + error.stack);
        } else {
            console.log('Score saved to MySQL!');
        }
    });
    query = 'INSERT INTO gamelog_table (id, time, userID, Score, playtime) VALUES ((SELECT COALESCE(MAX(id), 0) + 1 FROM gamelog_table ALIAS_FOR_SUBQUERY), now(), ?, ?, ?)';

    connection.query(query, [userID, score, Playtime]);
}
// 일정 간격으로 최고 점수를 모든 클라이언트에게 보냄
setInterval(() => {
    sendHighScoreToAllClients();
}, 1000); // 1초마다 실행되는 코드
function sendHighScoreToAllClients() {
    const query = 'SELECT MAX(Score) as highscore, ID as id FROM score_data';

    connection.query(query, (error, results, fields) => {
        if (error) {
            console.error('MySQL에서 최고 점수 가져오는 중 오류 발생: ' + error.stack);
        } else {
            if (results[0].highscore > currentHighScore) {
                currentHighScore = results[0].highscore
                wss.clients.forEach(client => {

                    if (client.readyState === WebSocket.OPEN) {
                        console.log("점수갱신");
                        client.send(JSON.stringify({ currentHighScore: currentHighScore, user: results[0].id, type: "CurrentHighScore" }));
                    }
                });
            }
        }
    });
}
