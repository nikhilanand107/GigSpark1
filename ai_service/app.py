import os
import json
import requests
import uuid
import tempfile
import speech_recognition as sr
from moviepy.editor import VideoFileClip
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

OPENROUTER_API_KEY = os.getenv('OPENROUTER_API_KEY')

def extract_audio(video_path, audio_path):
    try:
        video = VideoFileClip(video_path)
        # Use codec 'pcm_s16le' for standard wav file suitable for SpeechRecognition
        video.audio.write_audiofile(audio_path, codec='pcm_s16le', verbose=False, logger=None)
        
        # Explicitly close to avoid filesystem locks on Windows
        video.reader.close()
        try:
            video.audio.reader.close_proc()
        except:
            pass
        return True
    except Exception as e:
        print(f"Error extracting audio: {e}")
        return False

import pydub # type: ignore
from pydub import AudioSegment
import math

def transcribe_audio(audio_path) -> str:
    recognizer = sr.Recognizer()
    try:
        audio = AudioSegment.from_wav(audio_path)
        source_duration = len(audio) / 1000 # pydub works in ms
        chunk_length_ms = 60000 # 60 seconds
        chunks_count = math.ceil(len(audio) / chunk_length_ms)
        
        full_transcript = []
        print(f"Audio duration: {source_duration:.2f}s. Splitting into {chunks_count} chunks...")

        for i in range(chunks_count):
            start_ms = i * chunk_length_ms
            end_ms = min((i + 1) * chunk_length_ms, len(audio))
            chunk = audio[start_ms:end_ms]
            
            # Save chunk to temp file
            temp_chunk_path = f"{audio_path}_chunk_{i}.wav"
            chunk.export(temp_chunk_path, format="wav")
            
            try:
                with sr.AudioFile(temp_chunk_path) as source:
                    audio_data = recognizer.record(source)
                    text = str(recognizer.recognize_google(audio_data))
                    full_transcript.append(text)
            except sr.UnknownValueError:
                pass # No speech in this chunk
            except Exception as e:
                print(f"Error in chunk {i}: {e}")
            finally:
                if os.path.exists(temp_chunk_path):
                    os.remove(temp_chunk_path)
        
        return " ".join(full_transcript)
    except Exception as e:
        print(f"Error transcribing audio: {e}")
        return ""

def get_ai_review(transcript, skill_name):
    if not OPENROUTER_API_KEY:
        raise ValueError("OPENROUTER_API_KEY is missing")

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "GigSpark AI Review",
        "Content-Type": "application/json"
    }

    prompt = f"""
    You are an expert tutor evaluator. Review the following transcript from a tutor's demo video showcasing their skill: "{skill_name}".
    
    Transcript:
    "{transcript}"
    
    Provide:
    1. A numeric rating from 6 to 10 evaluating the clarity, expertise, and communication shown in the transcript.
    2. A short, constructive review (2-3 sentences max) for the learner who will book them.
    
    If the transcript is empty or says there's no intelligible speech, give a rating of 6 and mention that the video had no clear speech to evaluate.
    
    Return the response EXACTLY as a JSON object with this structure:
    {{
        "rating": number (between 6 and 10),
        "review": "string"
    }}
    """

    data = {
        "model": "deepseek/deepseek-chat",
        "messages": [
            {"role": "system", "content": "You output strict JSON."},
            {"role": "user", "content": prompt}
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 500
    }

    print("Sending request to OpenRouter...")
    response = requests.post("https://openrouter.ai/api/v1/chat/completions", headers=headers, json=data)
    
    if not response.ok:
        print(f"OpenRouter error: {response.text}")
        response.raise_for_status()
    
    result_text = response.json()['choices'][0]['message']['content']
    print(f"OpenRouter response: {result_text}")
    
    try:
        # Strip code blocks if deepseek added them
        if result_text.startswith("```json"):
            result_text = result_text.split("```json")[1].split("```")[0].strip()
        elif result_text.startswith("```"):
            result_text = result_text.split("```")[1].split("```")[0].strip()
            
        return json.loads(result_text)
    except json.JSONDecodeError:
        print(f"Failed to parse JSON: {result_text}")
        return {"rating": 7, "review": "The AI provided a review, but the format could not be processed natively. " + result_text[:50]}

@app.route('/api/review-video', methods=['POST'])
def review_video():
    data = request.json
    video_url = data.get('videoUrl')
    skill_name = data.get('skillName', 'Unknown Skill')

    if not video_url:
        return jsonify({"error": "No video URL provided"}), 400

    temp_dir = tempfile.gettempdir()
    session_id = str(uuid.uuid4())
    video_path = os.path.join(temp_dir, f"{session_id}.mp4")
    audio_path = os.path.join(temp_dir, f"{session_id}.wav")

    try:
        print(f"\n[{session_id}] Downloading video from {video_url}...")
        response = requests.get(video_url, stream=True)
        response.raise_for_status()
        with open(video_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)

        print(f"[{session_id}] Extracting audio as WAV...")
        if not extract_audio(video_path, audio_path):
             return jsonify({"error": "Failed to extract audio using moviepy"}), 500

        print(f"[{session_id}] Transcribing audio...")
        transcript = transcribe_audio(audio_path)
        
        if not transcript.strip():
             transcript = "[No intelligible speech detected in the video.]"

        print(f"[{session_id}] Transcript: {str(transcript)[:100]}...")

        print(f"[{session_id}] Requesting DeepSeek AI review...")
        review_data = get_ai_review(transcript, skill_name)
        
        print(f"[{session_id}] Completed. Rating: {review_data.get('rating')}")

        return jsonify({
            "success": True,
            "transcript": transcript,
            "aiRating": review_data.get("rating", 7),
            "aiReview": review_data.get("review", "Review generation failed.")
        })

    except Exception as e:
        print(f"Pipeline error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if os.path.exists(video_path):
            try:
                os.remove(video_path)
            except:
                pass
        if os.path.exists(audio_path):
            try:
                os.remove(audio_path)
            except:
                pass

if __name__ == '__main__':
    port = int(os.getenv('FLASK_PORT', 5001))
    print(f"Starting Flask AI Service on port {port}...")
    app.run(port=port, debug=True)
