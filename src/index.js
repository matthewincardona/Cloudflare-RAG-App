import { Ai } from '@cloudflare/ai'
import { Hono } from 'hono'

import ui from './ui.html'

const app = new Hono()

// 1. the ui for asking questions
app.get("/", c => {
	return c.html(ui)
})

// 2. a POST endpoint to query the LLM
app.get("/query", async c => {
	const ai = new Ai(c.env.AI)

	const question = c.req.query("text") || "What is the square root of 9?"

	const { response: answer } = await ai.run(
		"@cf/meta/llama-2-7b-chat-int8",
		{
			messages: [
				{ role: "system", content: "You are a helpful assistant" },
				{ role: "user", content: question },
			]
		}
	)
	return c.text(answer)
})

// 3. the ui for adding notes
// 4. a POST endpoint to add notes

export default app