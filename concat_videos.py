import os
import subprocess
import sys

def concat_videos(file1, file2, output):
    print(f"Concatenating {file1} and {file2} into {output}...")
    import static_ffmpeg
    static_ffmpeg.add_paths()
    
    # Using filter_complex ensures that even if formats/resolutions differ slightly, 
    # they are re-encoded into a uniform stream, avoiding glitches.
    cmd = [
        "ffmpeg", 
        "-y",
        "-i", file1,
        "-i", file2,
        "-filter_complex", "[0:v:0][1:v:0]concat=n=2:v=1:a=0[outv]",
        "-map", "[outv]",
        "-vsync", "2",
        output
    ]
    
    print("Running command:", " ".join(cmd))
    res = subprocess.run(cmd)
    if res.returncode == 0:
        print("Successfully concatenated videos.")
    else:
        print("Error concatenating videos.")

if __name__ == "__main__":
    base_dir = r"c:\work\code\onlytrade\agents\t_016"
    f1 = os.path.join(base_dir, "host1.mp4")
    f2 = os.path.join(base_dir, "host2.mp4")
    
    # the user typed hosts.mp4, check if that exists instead
    f_hosts = os.path.join(base_dir, "hosts.mp4")
    if os.path.exists(f_hosts):
        f2 = f_hosts
    elif not os.path.exists(f2):
        print(f"Could not find host2.mp4 or hosts.mp4 in {base_dir}")
        sys.exit(1)
        
    out = os.path.join(base_dir, "host_combined.mp4")
    concat_videos(f1, f2, out)
