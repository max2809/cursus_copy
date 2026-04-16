import httpx


RESEND_URL = "https://api.resend.com/emails"


class ResendClient:
    def __init__(self, api_key: str, default_from: str):
        self._api_key = api_key
        self._from = default_from

    async def send_magic_link(self, to: str, link: str) -> dict:
        subject = "Your Study Buddy login link"
        html = f"""
        <p>Click the link below to sign in to Study Buddy. It expires in 15 minutes.</p>
        <p><a href="{link}">{link}</a></p>
        <p>If you didn't request this, you can ignore this email.</p>
        """
        async with httpx.AsyncClient(timeout=10.0) as c:
            resp = await c.post(
                RESEND_URL,
                headers={"Authorization": f"Bearer {self._api_key}"},
                json={"from": self._from, "to": [to], "subject": subject, "html": html},
            )
            resp.raise_for_status()
            return resp.json()
