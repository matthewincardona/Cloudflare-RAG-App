import { Ai } from '@cloudflare/ai'
import { Hono } from 'hono'

import write from './write.html'
import ui from './ui.html'

const app = new Hono()

// 1. the ui for asking questions
app.get("/", c => {
	return c.html(ui)
})

// 2. a POST endpoint to query the LLM
app.get("/query", async c => {
	try {
	const ai = new Ai(c.env.AI);

	const question = c.req.query('text') || "What is the square root of 9?"

	const embeddings = await ai.run('@cf/baai/bge-base-en-v1.5', { text: [ question ] })
	const vectors = embeddings.data[0]
  
	const SIMILARITY_CUTOFF = 0.75;
	const vectorQuery = await c.env.VECTOR_INDEX.query(vectors, { topK: 1 }) || { matches: [] }; // Default to an empty array if vectorQuery is falsy
	const vecIds = vectorQuery.matches
	  ? vectorQuery.matches
		  .filter(vec => vec.score > SIMILARITY_CUTOFF)
		  .map(vec => vec.vectorId)
	  : [];
	  
	let notes = [];
	if (vecIds.length) {
	  const query = `SELECT * FROM notes WHERE id IN (${vecIds.join(", ")})`;
	  const { results } = await c.env.DATABASE.prepare(query).bind().all();
	  if (results) notes = results.map(vec => vec.text);
	}
	
	const contextMessage = notes.length
	  ? `Context:\n${notes.map(note => `- ${note}`).join("\n")}`
	  : "";
	
  
	const systemPrompt = `When answering the question or responding, use the context provided, if it is provided and relevant.`
  
	// const { response: answer } = await ai.run(
	//   '@cf/meta/llama-2-7b-chat-int8',
	//   {
	// 	inputs: [
	// 	  ...(notes.length ? [{ role: 'system', content: contextMessage }] : []),
	// 	  { role: 'system', content: systemPrompt },
	// 	  { role: 'user', content: question }
	// 	]
	//   }
	// )

	const { response: answer } = await ai.run(
		"@cf/meta/llama-2-7b-chat-int8",
		{
			messages: [
				{ role: "system", content: "You are a helpful assistant" },
				{ role: "user", content: question }
			]
		}
	)
  
	return c.text(answer);

	} catch (error) {
        console.error("Error processing /query endpoint:", error);
        return c.text("Internal Server Error", 500);
    }
})

// 3. the ui for adding notes
app.get("/write", c => {
	return c.html(write)
})

// 4. a POST endpoint to add notes
// 4a - insert note into d1 database
app.post("/notes", async c => {
	const ai = new Ai(c.env.AI)

	const { text } = await c.req.json();
	if (!text) c.throw(400, "Missing text");

	const { results } = await c.env.DATABASE.prepare("INSERT INTO notes (text) VALUES (?) RETURNING *")
		.bind(text)
		.run()

	const record = results.length ? results[0] : null

	if (!record) c.throw(500, "Failed to create note")

	// 4b - generate an embedding based on our note
	const { data } = await ai.run('@cf/baai/bge-base-en-v1.5', { text: [text] })
	const values = data[0]

	if (!values) c.throw(500, "Failed to generate vector embedding")

	// 4c - insert embedding into vectorize
	const { id } = record
	const inserted = await c.env.VECTOR_INDEX.upsert([
		{
			id: id.toString(),
			values,
		}
	]);

	return c.json({ id, text, inserted });
})

export default app