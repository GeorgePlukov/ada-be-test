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

const getStateById = (id) => new Promise((resolve, reject) => {
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

            const preferred_text = prefered_text_map[id] || await getStateById(id) || default_text;
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

// todo: prevent against sql injection attacks using prepared statements
const searchForQuery = (query) =>
    new Promise((resolve, reject) => {
        db.all(
            "select id, title from answers where title like $query",
            { $query: "%" + query + "%" },
            (err, rows_raw) => {
                if (err) {
                    reject(err);
                }
                resolve(rows_raw);
            }
        );
    });

const getBlocks = (a_id) =>
  new Promise((resolve, reject) => {
    db.all(
        "select id, content, answer_id from blocks where answer_id = $a_id",
        { $a_id: a_id },
        (err, rows_raw) => {
            if (err) {
                reject(err);
            }
            resolve(rows_raw);
        }
    );
  });
const joinedRows = () =>
  new Promise((resolve, reject) => {
    db.all(
      "select * from answers a inner join blocks b on a.id = b.answer_id",
      (err, rows_raw) => {
        if (err) {
          reject(err);
        }
        resolve(rows_raw);
      }
    );
  });

// Extract text from all top level fields and recursively iterate through
// any nested objects (arrays included)
const deepExtractText = (content) => {
    console.log(content)
    let extracted_text = '';
    for (const [key, value] of Object.entries(content)) {
        if (key === 'type') {
            continue;
        } else if (value === Object(value) ) {
            extracted_text += extractText(value);
        } else {
            extracted_text += value;
        }
    }
    return extracted_text;
};

// Search for answers
app.post("/search", (req, res) => {
    let query = req.body.query;
    if (!query) {
        res.status(400).send('Query is a required parameter');
        return
    }

    let jr = await joinedRows();
    const query_regex = new RegExp(query, 'g');

    // todo: potential optimization, pre search before parsing json so that we only parse on potential positives
    jr = jr.map((row) => {
        if (row.content) {
            row.content = JSON.parse(row.content);
        }
        return row;
    });
    
    // aggregate all the text from the title and the content sub fields
    const searchableText = jr.map((row) => deepExtractText(row));
    const searchHits = searchableText.map((text) => text.match(query_regex));
    const index = searchHits.reduce((acc, hit, index) => hit ? index : acc, -1);
    const result = jr[index] || [];

    res.status(200).send(result)
})

var server = app.listen(5000, () => {
    console.log("Express server listening on port " + server.address().port)
})
