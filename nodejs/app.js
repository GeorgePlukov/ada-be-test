const sqlite3 = require("sqlite3").verbose()
const express = require("express")

const app = express()
app.use(express.json())

let db = new sqlite3.Database("../database.db")


const curly_braces_regex = /[^{\}]+(?=})/g;

const getMessages = () => new Promise((resolve, rej) => {
    db.all(
        "SELECT body FROM messages",
        {},
        (err, rows_raw) => {
            if (err) {
                rej(err);
            } else {
                resolve(rows_raw.map((row) => row.body));
            }
        }
    );
});

const getState = (id) => new Promise((resolve, reject) => {
    db.get(
        `select value from state where id = \"${id}\"`,
        (err, item) => {
            if (err) {
                reject(err);
            }
            resolve(item && item.value);
    });
});

// Return all messages
app.get("/messages", async (req, res) => {

    const messages = await getMessages();
    const fixed_messages = [];

    for (let message of messages) {
        const replaceable_items = message.match(curly_braces_regex);

        const id_default_tuples = replaceable_items.map((str) => {
            return str.split("|");
        });

        const prefered_text_map = {};
        for (const element of id_default_tuples) {
            const id = element[0];
            const default_text = element[1];

            const preferred_text = prefered_text_map[id] || await getState(id) || default_text;
            prefered_text_map[id] = preferred_text;
        }

        // go through our items to be replaced and insert the text in our prefered text map 
        id_default_tuples.map((tuple, index) => {
            const text_to_replace_regex = `\{${tuple[0]}|${tuple[1]}\}`;
            const id = id_default_tuples[index][0];
            message = message
              .split(text_to_replace_regex)
              .join(prefered_text_map[id]);
        });
        fixed_messages.push(message);
    }
    res.send(fixed_messages);
})

// Search for answers
app.post("/search", (req, res) => {
    let query = req.body.query;

    db.all(
        "select id, title from answers where title like $query",
        { $query: "%" + query + "%" },
        (err, rows_raw) => {
            res.status(200).send(rows_raw);
        }
    )
})

var server = app.listen(5000, () => {
    console.log("Express server listening on port " + server.address().port)
})
