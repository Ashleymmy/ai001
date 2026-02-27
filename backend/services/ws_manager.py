"""WebSocket connection manager for workspace collaboration.

Manages per-workspace connections, broadcasts events to connected clients,
and tracks online member presence.
"""

import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

from fastapi import WebSocket


@dataclass
class ConnectedClient:
    ws: WebSocket
    workspace_id: str
    user_id: str
    user_name: str
    connected_at: float = field(default_factory=time.time)
    last_heartbeat: float = field(default_factory=time.time)


class WorkspaceWSManager:
    """Manages WebSocket connections grouped by workspace_id."""

    def __init__(self) -> None:
        # workspace_id -> list of connected clients
        self._connections: Dict[str, List[ConnectedClient]] = {}
        self._heartbeat_timeout_sec = 60

    async def connect(
        self,
        ws: WebSocket,
        workspace_id: str,
        user_id: str,
        user_name: str,
    ) -> ConnectedClient:
        await ws.accept()
        client = ConnectedClient(
            ws=ws,
            workspace_id=workspace_id,
            user_id=user_id,
            user_name=user_name,
        )
        if workspace_id not in self._connections:
            self._connections[workspace_id] = []
        self._connections[workspace_id].append(client)

        # Broadcast member_online to others
        await self.broadcast(
            workspace_id,
            {
                "type": "member_online",
                "user_id": user_id,
                "user_name": user_name,
                "online_members": self.get_online_members(workspace_id),
            },
            exclude_user=None,  # include everyone so the new user also gets the member list
        )
        return client

    def disconnect(self, client: ConnectedClient) -> None:
        workspace_id = client.workspace_id
        conns = self._connections.get(workspace_id, [])
        self._connections[workspace_id] = [c for c in conns if c is not client]
        if not self._connections[workspace_id]:
            del self._connections[workspace_id]

    async def broadcast_disconnect(self, client: ConnectedClient) -> None:
        """Broadcast member_offline after removing a client."""
        await self.broadcast(
            client.workspace_id,
            {
                "type": "member_offline",
                "user_id": client.user_id,
                "user_name": client.user_name,
                "online_members": self.get_online_members(client.workspace_id),
            },
        )

    async def broadcast(
        self,
        workspace_id: str,
        data: Dict[str, Any],
        exclude_user: Optional[str] = None,
    ) -> None:
        """Send a JSON message to all connected clients in a workspace."""
        conns = self._connections.get(workspace_id, [])
        payload = json.dumps(data, ensure_ascii=False)
        disconnected: List[ConnectedClient] = []

        for client in conns:
            if exclude_user and client.user_id == exclude_user:
                continue
            try:
                await client.ws.send_text(payload)
            except Exception:
                disconnected.append(client)

        for client in disconnected:
            self.disconnect(client)

    def get_online_members(self, workspace_id: str) -> List[Dict[str, str]]:
        """Return unique online members for a workspace."""
        conns = self._connections.get(workspace_id, [])
        seen: Set[str] = set()
        members: List[Dict[str, str]] = []
        for c in conns:
            if c.user_id not in seen:
                seen.add(c.user_id)
                members.append({"user_id": c.user_id, "user_name": c.user_name})
        return members

    def update_heartbeat(self, client: ConnectedClient) -> None:
        client.last_heartbeat = time.time()

    def get_workspace_connection_count(self, workspace_id: str) -> int:
        return len(self._connections.get(workspace_id, []))


# Global singleton
ws_manager = WorkspaceWSManager()
