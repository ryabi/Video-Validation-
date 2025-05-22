from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import logging

logger = logging.getLogger(__name__)

class ConnectionManager:
    active_connections = []
    
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.connected = False
    
    async def connect(self):
        try:
            # Accept the WebSocket connection
            await self.websocket.accept()
            self.connected = True
            self.active_connections.append(self.websocket)
            logger.info("WebSocket connection accepted")
            
            # Send initial connection success message
            await self.websocket.send_json({
                'type': 'connection_status',
                'data': {
                    'status': 'connected',
                    'message': 'WebSocket connection established'
                }
            })
        except Exception as e:
            logger.error(f"Error during WebSocket handshake: {str(e)}")
            if hasattr(self.websocket, 'client_state') and self.websocket.client_state != WebSocketState.DISCONNECTED:
                await self.websocket.close()
            raise

    async def disconnect(self):
        try:
            if self.websocket in self.active_connections:
                self.active_connections.remove(self.websocket)
            if self.connected and hasattr(self.websocket, 'client_state') and self.websocket.client_state != WebSocketState.DISCONNECTED:
                await self.websocket.close()
                self.connected = False
            logger.info("WebSocket connection closed")
        except Exception as e:
            logger.error(f"Error during WebSocket disconnect: {str(e)}")
        
    async def send_error(self, message):
        try:
            response = {
                'type': 'error',
                'data': {
                    'message': message
                }
            }
            logger.error(f"Sending error response: {response}")
            await self.websocket.send_json(response)
        except Exception as e:
            logger.error(f"Error sending error message: {str(e)}")
            await self.disconnect()

    async def send_validation_result(self, validation, validation_step):
        try:
            response = {
                'type': 'validation_result',
                'data': {
                    'validation': validation,
                    'validation_step': validation_step
                }
            }
            await self.websocket.send_json(response)
        except Exception as e:
            logger.error(f"Error sending validation result: {str(e)}")
            await self.disconnect()
           
    async def receive_json(self):
        try:
            data = await self.websocket.receive_json()
            if not isinstance(data, dict) or 'type' not in data:
                raise ValueError("Invalid message format")
            if data['type'] == 'frames':
                return data['data']
            else:
                logger.warning(f"Received unknown message type: {data['type']}")
                return None
        except WebSocketDisconnect:
            logger.info("Client disconnected")
            await self.disconnect()
            raise
        except Exception as e:
            logger.error(f"Error receiving message: {str(e)}")
            await self.disconnect()
            raise
    
        
    