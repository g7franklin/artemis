/**
 * @param {{ database: string, query: string }} _params
 */
export async function executeGetNotionContent(_params) {
  return {
    message: 'Notion integration coming soon',
    content: null,
  };
}

export const getNotionContentTool = {
  name: 'get_notion_content',
  description:
    "Retrieve content from Greg's Notion workspace (todos, projects, or goals). Phase 2 — not fully wired yet.",
  parameters: {
    type: 'object',
    properties: {
      database: {
        type: 'string',
        enum: ['todos', 'projects', 'goals'],
        description: 'Which Notion database to read from',
      },
      query: {
        type: 'string',
        description: 'Search or filter text',
      },
    },
    required: ['database', 'query'],
  },
};
