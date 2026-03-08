import os
import subprocess
import sys

def setup_tools():
    print("Installing yt-dlp and static-ffmpeg...")
    subprocess.run([sys.executable, "-m", "pip", "install", "yt-dlp", "static-ffmpeg"], check=True)
    
    # Try to add static_ffmpeg to path or find it
    try:
        import static_ffmpeg
        static_ffmpeg.add_paths()
        print("static-ffmpeg paths added.")
    except ImportError:
        print("Error: static-ffmpeg not found after installation.")
        return False
    return True

def download_segment(url, start_time, end_time, output_name):
    print(f"Downloading segment {start_time}-{end_time} from {url}...")
    # Using yt-dlp with --download-sections
    # Note: static-ffmpeg adds ffmpeg to the environment's PATH effectively for the current process
    cmd = [
        "python", "-m", "yt_dlp",
        "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]",
        "--download-sections", f"*{start_time}-{end_time}",
        "--force-keyframes-at-cuts",
        url,
        "-o", output_name
    ]
    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd)
    if result.returncode == 0:
        print(f"Successfully saved {output_name}")
    else:
        print(f"Failed to download {output_name}")

if __name__ == "__main__":
    if setup_tools():
        tasks = [
            ("https://www.youtube.com/watch?v=mdwY_cLWshw", 0, 60, "segment1_mdwY.mp4"),
            ("https://www.youtube.com/watch?v=sRhLnrQvYsw", 90, 120, "segment2_sRhL_130_200.mp4"),
            ("https://www.youtube.com/watch?v=sRhLnrQvYsw", 20, 50, "segment3_sRhL_020_050.mp4"),
            ("https://www.youtube.com/watch?v=7-TaFkR6zzs", 20, 50, "segment4_7TaF_020_050.mp4")
        ]
        
        for url, start, end, name in tasks:
            download_segment(url, start, end, name)
