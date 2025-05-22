from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketException, WebSocketDisconnect
from pydantic import BaseModel
from Validation import ConnectionManager
import base64
from PIL import Image
import io
import logging
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import numpy as np
from starlette.middleware.cors import CORSMiddleware
from fastapi.middleware.cors import CORSMiddleware


model={}
log={}

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger = logging.getLogger(__name__)
    logger.setLevel(logging.INFO)
    
    formatter = logging.Formatter(
    '%(asctime)s - %(levelname)s - [%(name)s] - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
    )
    file_handler = logging.FileHandler('validation.log')
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
    logger.propagate = False
    
    log['logger']=logger
    
    BaseOptions = mp.tasks.BaseOptions
    PoseLandmarker = mp.tasks.vision.PoseLandmarker
    PoseLandmarkerOptions = mp.tasks.vision.PoseLandmarkerOptions
    # PoseLandmarkerResult = mp.tasks.vision.PoseLandmarkerResult
    VisionRunningMode = mp.tasks.vision.RunningMode

    #For gesture recognition model. Configuring Model
    gesture_BaseOptions = mp.tasks.BaseOptions
    GestureRecognizer = mp.tasks.vision.GestureRecognizer
    GestureRecognizerOptions = mp.tasks.vision.GestureRecognizerOptions
    gesture_VisionRunningMode = mp.tasks.vision.RunningMode
    
    try :
        pose_options = PoseLandmarkerOptions(
                        base_options=BaseOptions(model_asset_path='data/pose_landmarker_heavy.task'),
                        running_mode=VisionRunningMode.IMAGE,
                        min_pose_detection_confidence=0.55,
                        min_pose_presence_confidence=0.55,
                        output_segmentation_masks=False
                    )

                    # Initialize gesture recognizer options
        gesture_options = GestureRecognizerOptions(
                        base_options=gesture_BaseOptions(model_asset_path='data/gesture_recognizer.task'),
                        running_mode=gesture_VisionRunningMode.IMAGE,
                        min_hand_detection_confidence=0.55,
                        min_hand_presence_confidence=0.55,
                    )
                    # Create model instances
        model['pose_landmarker'] = PoseLandmarker.create_from_options(pose_options)
        model['gesture_recognizer'] = GestureRecognizer.create_from_options(gesture_options)
        
        log['logger'].info(f"Models Initialized")
    except Exception as e :
        log['logger'].info(f"Problem during Model Initialization")  
        
    yield
    model.clear()
    log.clear()

app = FastAPI(lifespan=lifespan)

# Update CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.websocket("/video/")
async def websocket_endpoint(websocket: WebSocket):
    print("New WebSocket connection attempt")
    manager = ConnectionManager(websocket=websocket)
    
    try:
        # Establish connection with proper handshake
        await manager.connect()
        print("WebSocket connection established")
        
        while True:
            try:
                # Wait for messages
                data = await manager.receive_json()
                if data:
                    await process_frames(data, manager)
            except WebSocketDisconnect:
                print("Client disconnected")
                break
            except Exception as e:
                print(f"Error processing message: {str(e)}")
                await manager.send_error(str(e))
                
    except Exception as e:
        print(f"Connection error: {str(e)}")
    finally:
        await manager.disconnect()
        print("WebSocket connection closed")

async def process_frames(data,manager:ConnectionManager):
        try:    
            frames = data['frames']
            validation_step = data['validation_step']
            batch_number = data['batch_number']
            gesture_recognize = data['gesture_recognize']
            

            if not gesture_recognize:
                true_counter = 0
                false_counter = 0
                for frame in frames:
                    try:
                        if 'base64' in frame:
                            frame = frame.split('base64,')[1]
                            img_data = base64.b64decode(frame)
                            pil_image = Image.open(io.BytesIO(img_data)).convert('RGB')
                            np_img = np.array(pil_image)
                            mp_image = mp.Image(
                                image_format=mp.ImageFormat.SRGB, 
                                data=np_img
                            )
                            
                            result = model['pose_landmarker'].detect(mp_image)
                            
                            if not result.pose_landmarks:
                                log['logger'].warning(f"Client  - No pose landmarks detected")
                                await manager.send_validation_result('not_validated', validation_step)
                                return

                            if validation_step == 'leftHand':
                                left_valid = left_hand_validation(result)
                                right_valid = right_hand_validation(result)
                                is_valid = left_valid and not right_valid
                            elif validation_step == 'rightHand':
                                left_valid = left_hand_validation(result)
                                right_valid = right_hand_validation(result)
                                is_valid = right_valid and not left_valid
                            elif validation_step == 'bothHands':
                                left_valid = left_hand_validation(result)
                                right_valid = right_hand_validation(result)
                                is_valid = left_valid and right_valid
                            else:
                                is_valid = False
                                log['logger'].warning(f"Client  - Unknown validation step: {validation_step}")

                            if is_valid:
                                true_counter += 1
                            else:
                                false_counter += 1

                            if true_counter >= 3:
                                await manager.send_validation_result('validated', validation_step)
                                log['logger'].info(f"Client - {validation_step} validation successful")
                                return 
                            if false_counter >= 5:
                                await manager.send_validation_result('not_validated', validation_step)
                                log['logger'].info(f"Client - {validation_step} validation failed")
                                return 

                    except Exception as e:
                        log['logger'].error(f"Client  - Error processing frame: {str(e)}")
                        await manager.send_error(f"Error processing frame: {str(e)}")
                        return

            elif gesture_recognize:
                true_counter = 0
                false_counter = 0
                for frame in frames:
                    try:
                        if 'base64' in frame:
                            frame = frame.split('base64,')[1]
                            img_data = base64.b64decode(frame)
                            
                            pil_image = Image.open(io.BytesIO(img_data)).convert('RGB')
                            np_img = np.array(pil_image)
                            mp_image = mp.Image(
                                image_format=mp.ImageFormat.SRGB, 
                                data=np_img
                            )
                            
                            gesture_result = model['gesture_recognizer'].recognize(mp_image)
                            
                            if gesture_result.gestures and gesture_result.gestures[0]:
                                detected_gesture = gesture_result.gestures[0][0].category_name
                                is_valid = detected_gesture == validation_step
                                
                                if is_valid:
                                    true_counter += 1
                                else:
                                    false_counter += 1

                                if true_counter >= 3:
                                    await manager.send_validation_result('validated', validation_step)
                                    log['logger'].info(f"Client  - {validation_step} gesture validation successful")
                                    return
                                if false_counter >= 7:
                                    await manager.send_validation_result('not_validated', validation_step)
                                    log['logger'].info(f"Client - {validation_step} gesture validation failed")
                                    return

                    except Exception as e:
                        log['logger'].error(f"Client  - Error processing gesture frame: {str(e)}")
                        await manager.send_error(f"Error processing gesture frame: {str(e)}")
                        return

        except Exception as e:
            log['logger'].error(f"Client - Error processing frames: {str(e)}")
            await manager.send_error(f"Error processing frames: {str(e)}")
            return

def left_hand_validation( detection_result):
        if not detection_result.pose_landmarks:
            return False
        pose_landmarks_list = detection_result.pose_landmarks
        try:
            leftRaise = (
                (pose_landmarks_list[0][13].y > pose_landmarks_list[0][19].y) and 
                (pose_landmarks_list[0][13].y > pose_landmarks_list[0][15].y) and
                (pose_landmarks_list[0][13].visibility > 0.55) and 
                (pose_landmarks_list[0][13].presence > 0.55)
            )
            return leftRaise
        except Exception as e:
            log['logger'].error(f"Client  - Error in left hand validation: {str(e)}")
            return False

def right_hand_validation(detection_result):
        if not detection_result.pose_landmarks:
            return False
        pose_landmarks_list = detection_result.pose_landmarks
        try:
            rightRaise = (
                (pose_landmarks_list[0][14].y > pose_landmarks_list[0][20].y) and
                (pose_landmarks_list[0][14].y > pose_landmarks_list[0][16].y) and
                (pose_landmarks_list[0][14].visibility > 0.55) and 
                (pose_landmarks_list[0][14].presence > 0.55)
            )
            return rightRaise
        except Exception as e:
            log['logger'].error(f"Client - Error in right hand validation: {str(e)}")
            return False
    
        