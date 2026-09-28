import { useState, useCallback, useRef, useEffect } from "react";
import type { SourceMode } from "../types.ts";
import type { ImageFormat } from "../services/imageApi.ts";
import { errorMessage } from "../utils.ts";

/** キャプチャで要求する最大解像度（4K） */
const MAX_CAPTURE_WIDTH = 3840;
const MAX_CAPTURE_HEIGHT = 2160;

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

    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError(
        "画面キャプチャの開始に失敗しました: お使いの環境では画面キャプチャ (getDisplayMedia) がサポートされていません。",
      );
      setActiveSource("none");
      return;
    }

    try {
      const mediaStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "window",
          // 指定しないと 1920x1080 に縮小されるため、高解像度を要求する（元の解像度を超えて拡大はされない）。
          // 英文の読み取りが目的なので、フレームレートより解像度を優先する
          width: { ideal: MAX_CAPTURE_WIDTH },
          height: { ideal: MAX_CAPTURE_HEIGHT },
          frameRate: { ideal: 5 },
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
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        setError("画面共有のアクセスがキャンセルまたは拒否されました。");
      } else {
        setError(`画面キャプチャの開始に失敗しました: ${errorMessage(err)}`);
      }
      setActiveSource("none");
    }
  }, [stopStream]);

  const startCameraCapture = useCallback(async () => {
    setError(null);
    stopStream();

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        "カメラの起動に失敗しました: お使いの環境ではカメラ (getUserMedia) がサポートされていません。",
      );
      setActiveSource("none");
      return;
    }

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: MAX_CAPTURE_WIDTH },
          height: { ideal: MAX_CAPTURE_HEIGHT },
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
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        setError("カメラアクセスの許可が得られませんでした。");
      } else {
        setError(`カメラの起動に失敗しました: ${errorMessage(err)}`);
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
  const captureFrame = useCallback((format: ImageFormat): string | null => {
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
    return canvas.toDataURL(format.type, format.quality);
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
