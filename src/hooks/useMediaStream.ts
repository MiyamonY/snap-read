import { useState, useCallback, useRef, useEffect } from "react";
import { SourceMode } from "../types.ts";

export function useMediaStream() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [activeSource, setActiveSource] = useState<SourceMode | "none">("none");
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const stopStream = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setActiveSource("none");
  }, [stream]);

  const startScreenCapture = useCallback(async () => {
    setError(null);
    stopStream();

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error(
          "お使いの環境では画面キャプチャ (getDisplayMedia) がサポートされていません。",
        );
      }

      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "window",
        },
        audio: false,
      });

      // Handle when user stops sharing via browser UI
      mediaStream.getVideoTracks()[0].addEventListener("ended", () => {
        stopStream();
      });

      setStream(mediaStream);
      setActiveSource("screen");

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        setError("画面共有のアクセスがキャンセルまたは拒否されました。");
      } else {
        setError(`画面キャプチャの開始に失敗しました: ${err.message || String(err)}`);
      }
      setActiveSource("none");
    }
  }, [stopStream]);

  const startCameraCapture = useCallback(async () => {
    setError(null);
    stopStream();

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("お使いの環境ではカメラ (getUserMedia) がサポートされていません。");
      }

      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: "environment",
        },
        audio: false,
      });

      mediaStream.getVideoTracks()[0].addEventListener("ended", () => {
        stopStream();
      });

      setStream(mediaStream);
      setActiveSource("camera");

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err: any) {
      if (err.name === "NotAllowedError") {
        setError("カメラアクセスの許可が得られませんでした。");
      } else {
        setError(`カメラの起動に失敗しました: ${err.message || String(err)}`);
      }
      setActiveSource("none");
    }
  }, [stopStream]);

  // Keep videoRef updated when stream changes
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [stream]);

  /**
   * 現在のビデオフレームを静止画としてキャプチャ
   */
  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.95);
  }, []);

  return {
    stream,
    activeSource,
    isStreaming: !!stream,
    error,
    videoRef,
    startScreenCapture,
    startCameraCapture,
    stopStream,
    captureFrame,
  };
}
