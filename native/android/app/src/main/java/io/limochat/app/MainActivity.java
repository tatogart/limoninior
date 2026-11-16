package io.limochat.app;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import java.util.*;

public class MainActivity extends Activity {
 private static final String HOME="https://81-90-31-167.sslip.io/";
 private WebView web;
 private FrameLayout root;
 private ProgressBar progress;
 private LinearLayout error;
 private ValueCallback<Uri[]> files;
 private PermissionRequest media;
 private GeolocationPermissions.Callback location;
 private String locationOrigin;
 private View fullScreen;
 private WebChromeClient.CustomViewCallback fullScreenCallback;
 private static boolean trusted(String url) {
  try { Uri u=Uri.parse(url);return "https".equals(u.getScheme())&&"81-90-31-167.sslip.io".equals(u.getHost())&&(u.getPort()==-1||u.getPort()==443); }catch(Exception e){return false;}
 }
 @Override public void onCreate(Bundle state) {
  super.onCreate(state);getWindow().setStatusBarColor(Color.rgb(16,24,32));
  root=new FrameLayout(this);root.setFitsSystemWindows(true);setContentView(root);
  web=new WebView(this);root.addView(web,new FrameLayout.LayoutParams(-1,-1));
  WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setDatabaseEnabled(true);s.setAllowFileAccess(false);s.setAllowContentAccess(true);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);s.setMediaPlaybackRequiresUserGesture(false);s.setUserAgentString(s.getUserAgentString()+" LimochatAndroid/1.0");
  CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
  progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);FrameLayout.LayoutParams pp=new FrameLayout.LayoutParams(-1,6,Gravity.TOP);root.addView(progress,pp);
  error=new LinearLayout(this);error.setOrientation(LinearLayout.VERTICAL);error.setGravity(Gravity.CENTER);error.setPadding(32,32,32,32);error.setBackgroundColor(Color.rgb(246,249,247));
  TextView label=new TextView(this);label.setText("Не удалось открыть Limochat.\nПроверьте интернет и попробуйте снова.");label.setTextSize(18);label.setGravity(Gravity.CENTER);error.addView(label);
  Button retry=new Button(this);retry.setText("Повторить");retry.setOnClickListener(v->{error.setVisibility(View.GONE);web.loadUrl(HOME);});error.addView(retry);root.addView(error,new FrameLayout.LayoutParams(-1,-1));error.setVisibility(View.GONE);
  web.setWebViewClient(new WebViewClient(){
   @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest r){if(trusted(r.getUrl().toString()))return false;external(r.getUrl());return true;}
   @Override public void onPageFinished(WebView v,String url){CookieManager.getInstance().flush();}
   @Override public void onReceivedError(WebView v,WebResourceRequest req,WebResourceError e){if(req.isForMainFrame())error.setVisibility(View.VISIBLE);}
   // Certificate errors retain the default cancellation behavior.
  });
  web.setWebChromeClient(new WebChromeClient(){
   @Override public void onProgressChanged(WebView view,int value){progress.setProgress(value);progress.setVisibility(value==100?View.GONE:View.VISIBLE);}
   @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){if(files!=null)files.onReceiveValue(null);files=callback;try{Intent i=params.createIntent();i.addCategory(Intent.CATEGORY_OPENABLE);startActivityForResult(i,11);}catch(Exception e){files.onReceiveValue(null);files=null;return false;}return true;}
   @Override public void onPermissionRequest(PermissionRequest request){runOnUiThread(()->{if(!trusted(request.getOrigin().toString())||!trusted(web.getUrl())){request.deny();return;}if(media!=null){request.deny();return;}media=request;ArrayList<String> needs=new ArrayList<>();for(String r:request.getResources()){String p=PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)?Manifest.permission.RECORD_AUDIO:PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)?Manifest.permission.CAMERA:null;if(p!=null&&checkSelfPermission(p)!=PackageManager.PERMISSION_GRANTED)needs.add(p);}if(needs.isEmpty())grantMedia();else requestPermissions(needs.toArray(new String[0]),12);});}
   @Override public void onPermissionRequestCanceled(PermissionRequest request){if(media==request)media=null;}
   @Override public void onGeolocationPermissionsShowPrompt(String origin,GeolocationPermissions.Callback callback){if(!trusted(origin)||!trusted(web.getUrl())){callback.invoke(origin,false,false);return;}if(location!=null){callback.invoke(origin,false,false);return;}location=callback;locationOrigin=origin;if(checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED)grantLocation();else requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},13);}
   @Override public void onShowCustomView(View view,CustomViewCallback callback){if(fullScreen!=null){callback.onCustomViewHidden();return;}fullScreen=view;fullScreenCallback=callback;root.addView(view,new FrameLayout.LayoutParams(-1,-1));web.setVisibility(View.INVISIBLE);}
   @Override public void onHideCustomView(){hideFullScreen();}
  });
  web.setDownloadListener((url,userAgent,contentDisposition,mime,length)->{
   if(!trusted(url)){external(Uri.parse(url));return;}
   new AlertDialog.Builder(this).setTitle("Скачать файл?").setMessage(URLUtil.guessFileName(url,contentDisposition,mime)).setNegativeButton("Отмена",null).setPositiveButton("Скачать",(d,w)->{try{DownloadManager.Request r=new DownloadManager.Request(Uri.parse(url));r.addRequestHeader("Cookie",CookieManager.getInstance().getCookie(url));r.addRequestHeader("User-Agent",userAgent);r.setMimeType(mime);r.setTitle(URLUtil.guessFileName(url,contentDisposition,mime));r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,URLUtil.guessFileName(url,contentDisposition,mime));((DownloadManager)getSystemService(DOWNLOAD_SERVICE)).enqueue(r);}catch(Exception e){Toast.makeText(this,"Не удалось начать загрузку",Toast.LENGTH_LONG).show();}}).show();
  });
  if(state==null||web.restoreState(state)==null)web.loadUrl(HOME);
 }
 private void external(Uri url){if(!Arrays.asList("https","http","mailto","tel").contains(url.getScheme()))return;try{startActivity(new Intent(Intent.ACTION_VIEW,url));}catch(Exception e){Toast.makeText(this,"Нет приложения для этой ссылки",Toast.LENGTH_SHORT).show();}}
 private void grantMedia(){if(media==null)return;ArrayList<String> allowed=new ArrayList<>();for(String r:media.getResources())if((PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(r)&&checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)||(PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)&&checkSelfPermission(Manifest.permission.CAMERA)==PackageManager.PERMISSION_GRANTED))allowed.add(r);if(allowed.isEmpty())media.deny();else media.grant(allowed.toArray(new String[0]));media=null;}
 private void grantLocation(){if(location!=null){location.invoke(locationOrigin,checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED||checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED,false);location=null;}}
 @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);if(request==12)grantMedia();if(request==13)grantLocation();}
 @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request==11&&files!=null){files.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));files=null;}}
 private void hideFullScreen(){if(fullScreen!=null){root.removeView(fullScreen);fullScreen=null;web.setVisibility(View.VISIBLE);fullScreenCallback.onCustomViewHidden();fullScreenCallback=null;}}
 @Override public void onBackPressed(){if(fullScreen!=null){hideFullScreen();return;}if(web.canGoBack())web.goBack();else new AlertDialog.Builder(this).setMessage("Закрыть Limochat?").setNegativeButton("Остаться",null).setPositiveButton("Закрыть",(d,w)->finish()).show();}
 @Override protected void onSaveInstanceState(Bundle state){web.saveState(state);super.onSaveInstanceState(state);}
 @Override protected void onPause(){CookieManager.getInstance().flush();super.onPause();}
 @Override protected void onDestroy(){if(files!=null)files.onReceiveValue(null);if(media!=null)media.deny();web.destroy();super.onDestroy();}
}
