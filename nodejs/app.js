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
    try {
        const messages = await getMessages();
        const fixed_messages = [];

        for (let message of messages) {
            const replaceable_items = message.match(curly_braces_regex);

            const id_default_tuples = replaceable_items.map((str) => {
                return str.split("|");
            });

            const preferred_text_map = {};
            for (const element of id_default_tuples) {
                const id = element[0];
                const default_text = element[1];

                const preferred_text = preferred_text_map[id] || await getStateById(id) || default_text;
                preferred_text_map[id] = preferred_text;
            }

            // go through our items to be replaced and insert the text from preferred text map
            id_default_tuples.map((tuple, index) => {
                const text_to_replace_regex = `\{${tuple[0]}|${tuple[1]}\}`;
                const id = id_default_tuples[index][0];
                message = message
                  .split(text_to_replace_regex)
                  .join(preferred_text_map[id]);
            });

            fixed_messages.push(message);
        }
        res.send(fixed_messages);
    } catch (error) {
        // don't expose the error to the client side in case it contains sensitive information
        res.status(503).send('Internal server error');

        // log error so that we can monitor from our internal logs
        console.error(error);
        return;
    }
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

const getAnswersWithBlocks = () =>
  new Promise((resolve, reject) => {
    db.all(
      "select  a.id, a.title, b.content from answers a inner join blocks b on a.id = b.answer_id",
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
    let extracted_text = '';
    for (const [key, value] of Object.entries(content)) {
        extracted_text += value.title || '';
        if (key === 'type') {
            continue;
        } else if (value === Object(value) ) {
            extracted_text += deepExtractText(value);
        } else {
            extracted_text += value;
        }
    }
    return extracted_text.toLowerCase();
};

// Search for answers
app.post("/search", async (req, res) => {
    let query = req.body.query;

    if (!query) {
        console.error('Query is a required parameter')
        res.status(400).send('Query is a required parameter');
        return
    }
    try {

        // normalize and split into words
        const queryWords = query.toLowerCase().split(' ');

        let answersWithBlocks = await getAnswersWithBlocks();

        // todo: potential optimization, pre search before parsing json so that we only parse potential positives
        // this would give false positives for strings contained within object keys and the type field but could
        // significantly reduce the amount of times JSON.parse is called
        const parsedAnswersWithBlocks = answersWithBlocks.map((row) => {
            if (row.content) {
                row.content = JSON.parse(row.content);
            }
            return row;
        });

        // aggregate all the text from the title and the nested content objects
        const searchableText = parsedAnswersWithBlocks.map((row) => deepExtractText(row));

        // To find our hits we iterate through our searchable text strings and look to see if all words appear somewhere within
        // requirement: searching for multiple terms that **all** have to show up **somewhere** in the answer.
        const searchHits = searchableText.map((text, index) => {
            for (const word of queryWords) {
                if (!text.includes(word)) {
                    return false;
                }
            }
            // If all the words have a hit return that parsed answer so we can send it back in our response
            return parsedAnswersWithBlocks[index];
        }).filter((hit) => hit);

        res.status(200).send(searchHits)
    } catch (error) {
        // don't expose the error to the client side in case it contains sensitive information
        res.status(503).send('Internal server error');

        // log error so that we can monitor from our internal logs
        console.error(error);
        return;
    }
})

var server = app.listen(5000, () => {
    console.log("Express server listening on port " + server.address().port)
})
