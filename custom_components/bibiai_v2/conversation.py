"""Forward Assist requests to BibiAI without running a model inside Home Assistant."""
import aiohttp
from homeassistant.components.conversation import (
    AssistantContent, ChatLog, ConversationEntity, ConversationEntityFeature,
    ConversationInput, ConversationResult,
)
from homeassistant.helpers import intent
from homeassistant.helpers.aiohttp_client import async_get_clientsession

async def async_setup_entry(hass, entry, async_add_entities):
    async_add_entities([BibiConversation(entry)])

class BibiConversation(ConversationEntity):
    _attr_name = 'BibiAI v2'
    _attr_supported_features = ConversationEntityFeature.CONTROL
    _attr_has_entity_name = True

    def __init__(self, entry):
        self._entry = entry
        self._attr_unique_id = entry.entry_id

    @property
    def supported_languages(self):
        return '*'

    async def _async_handle_message(self, user_input: ConversationInput, chat_log: ChatLog) -> ConversationResult:
        response = intent.IntentResponse(language=user_input.language)
        conversation_id = user_input.conversation_id
        subject = user_input.context.user_id or ('device:' + str(getattr(user_input, 'device_id', None) or 'assist'))
        payload = {'text': user_input.text, 'userId': subject}
        if conversation_id:
            payload['conversationId'] = conversation_id
        try:
            session = async_get_clientsession(self.hass)
            async with session.post(self._entry.data['url'] + '/v1/assist', json=payload,
                    headers={'Authorization': 'Bearer ' + self._entry.data['api_key']},
                    timeout=aiohttp.ClientTimeout(total=120)) as result:
                result.raise_for_status()
                data = await result.json()
            text = str(data['text'])
            conversation_id = data.get('conversationId', conversation_id)
            chat_log.async_add_assistant_content_without_tools(AssistantContent(agent_id=user_input.agent_id, content=text))
            response.async_set_speech(text)
        except (aiohttp.ClientError, TimeoutError, ValueError, KeyError):
            response.async_set_error(intent.IntentResponseErrorCode.UNKNOWN, 'BibiAI is unavailable. Check the add-on and its connections.')
        return ConversationResult(response=response, conversation_id=conversation_id)
