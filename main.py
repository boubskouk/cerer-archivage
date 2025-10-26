from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from typing import List
import os

app = FastAPI()

# Configuration CORS pour permettre les requêtes depuis React
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Dossier pour stocker les fichiers uploadés
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.get("/")
def read_root():
    return {"message": "Bienvenue sur l'API d'archivage CERER"}

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    file_path = os.path.join(UPLOAD_DIR, file.filename)
    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)
    return {"filename": file.filename, "status": "uploaded"}

@app.get("/files")
def list_files():
    files = os.listdir(UPLOAD_DIR)
    return {"files": files}