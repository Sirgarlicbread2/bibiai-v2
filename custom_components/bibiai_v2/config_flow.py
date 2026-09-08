"""Configure the connection to the BibiAI add-on."""
import aiohttp
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers import selector

class ConfigFlow(config_entries.ConfigFlow, domain="bibiai_v2"):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        errors = {}
        if user_input is not None:
            url = user_input['url'].rstrip('/')
            try:
                if not url.startswith(('http://', 'https://')) or len(user_input['api_key']) < 24:
                    raise ValueError('Invalid connection settings')
                session = async_get_clientsession(self.hass)
                async with session.get(url + '/v1/health', headers={'Authorization': 'Bearer ' + user_input['api_key']}, timeout=aiohttp.ClientTimeout(total=10)) as response:
                    response.raise_for_status()
                    await response.json()
                await self.async_set_unique_id(url)
                self._abort_if_unique_id_configured()
                return self.async_create_entry(title='BibiAI v2', data={**user_input, 'url': url})
            except (aiohttp.ClientError, TimeoutError, ValueError):
                errors['base'] = 'cannot_connect'
        return self.async_show_form(step_id='user', errors=errors, data_schema=vol.Schema({
            vol.Required('url', default='http://local-bibiai-v2:8100'): str,
            vol.Required('api_key'): selector.TextSelector(selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)),
        }))
