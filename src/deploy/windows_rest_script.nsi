!include "MUI2.nsh"
!define NB "NooBaaS3REST"
!define ICON "noobaa_icon24.ico"
!define Version "0.1.0.0"
!define SMDIR "$SMPROGRAMS\${NB}"
!define UNINST "Uninstall-${NB}"
!include "FileFunc.nsh"
!include "StrFunc.nsh"
${StrRep}
!include "CharToASCII.nsh"
!include "Base64.nsh"
!include x64.nsh


; Usage example:
; noobaa-s3rest.exe /address "wss://noobaa-alpha.herokuapp.com" /S /system_name demo /access_key 123 /secret_key abc
;
; or
;
; noobaa-s3rest.exe /S /config <agent_conf.json with base 64 encoding>
;
OutFile "noobaa-s3rest.exe"
BrandingText "${NB}"

InstallDir "$PROGRAMFILES\${NB}"
RequestExecutionLevel admin

!define writeFile "!insertmacro writeFile"

!macro writeFile File String
Push "${String}"
Push "${File}"
Call writeFile
!macroend

Function writeFile
; Stack: <file> <string>
ClearErrors
; Notice we are preserving registers $0, $1 and $2
Exch $0                     ; Stack: $0 <string>
Exch                        ; Stack: <string> $0
Exch $1                     ; Stack: $1 $0
Push $2                     ; Stack: $2 $1 $0
; $0 = file
; $1 = string
FileOpen $2 "$0" "a"
FileSeek $2 0 END
FileWrite $2 "$1$\r$\n"
FileClose $2
Pop $2                      ; Stack: $1 $0
Pop $1                      ; Stack: $0
Pop $0                      ; Stack: -empty-
FunctionEnd

;Check if we have config parameter. if not, abort
Function .onInit
	Var /global address
	Var /global system_id
	Var /global access_key
	Var /global secret_key
	Var /global system
	Var /global config
	Var /global UPGRADE
	;Install or upgrade?
	StrCpy $UPGRADE "false"
	Var /global AUTO_UPGRADE

	;check first if there is an old installation on program files (x86)
	;if so, just upgrade with x64 binaries

	StrCpy $InstDir "$PROGRAMFILES\${NB}"
	IfFileExists $INSTDIR\agent_conf.json IgnoreError SetRunningFolder
		SetRunningFolder:
			${If} ${RunningX64}
				# 64 bit code
				StrCpy $InstDir "$PROGRAMFILES64\${NB}"
			${Else}
				# 32 bit code
				StrCpy $InstDir "$PROGRAMFILES\${NB}"
			${EndIf}
		IgnoreError:
			ClearErrors


	${GetOptions} $CMDLINE "/config" $config
	${If} ${Errors}
		${GetOptions} $CMDLINE "/address" $address
		${GetOptions} $CMDLINE "/system_name" $system
		${GetOptions} $CMDLINE "/system_id" $system_id
		${GetOptions} $CMDLINE "/access_key" $access_key
		ClearErrors
		${GetOptions} $CMDLINE "/secret_key" $secret_key
		${If} ${Errors}
			IfFileExists $INSTDIR\agent_conf.json SkipError AbortInstall
				AbortInstall:
					MessageBox MB_OK "missing /config parameter!"
					Abort
				SkipError:
					StrCpy $UPGRADE "true"
		${EndIf}

	${EndIf}

FunctionEnd

# default section

!define MUI_COMPONENTSPAGE_SMALLDESC
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_LANGUAGE English
VIProductVersion ${Version}
VIAddVersionKey ProductName "${NB} Local Service"
VIAddVersionKey Comments ""
VIAddVersionKey CompanyName "${NB}"
VIAddVersionKey LegalCopyright "Y.G ${NB} Ltd."
VIAddVersionKey FileDescription "${NB} Local Service for Storage"
VIAddVersionKey FileVersion ${Version}
VIAddVersionKey ProductVersion ${Version}
VIAddVersionKey InternalName "${NB} Local Service"
VIAddVersionKey LegalTrademarks "${NB} is a Trademark of Y.G ${NB} Ltd."

UninstPage uninstConfirm
UninstPage instfiles
Name "${NB}"
Icon "${ICON}"

UninstallIcon "${ICON}"

Section "NooBaa S3 REST Service"

	SetOutPath $INSTDIR

	${If} $UPGRADE == "false"
		${If} $config == ""
			${WriteFile} "$INSTDIR\agent_conf.json" "{"
			${WriteFile} "$INSTDIR\agent_conf.json" "$\"dbg_log_level$\": 0,"
			${WriteFile} "$INSTDIR\agent_conf.json" "$\"address$\": $\"$address$\","
			${WriteFile} "$INSTDIR\agent_conf.json" "$\"system$\": $\"$system$\","
			${WriteFile} "$INSTDIR\agent_conf.json" "$\"tier$\": $\"nodes$\","
			${WriteFile} "$INSTDIR\agent_conf.json" "$\"prod$\": $\"true$\","
			${WriteFile} "$INSTDIR\agent_conf.json" "$\"bucket$\": $\"files$\","
			${WriteFile} "$INSTDIR\agent_conf.json" "$\"root_path$\": $\"./agent_storage/$\","
			${WriteFile} "$INSTDIR\agent_conf.json" "$\"access_key$\": $\"$access_key$\","
			${WriteFile} "$INSTDIR\agent_conf.json" "$\"secret_key$\": $\"$secret_key$\""
			${WriteFile} "$INSTDIR\agent_conf.json" "}"

		${Else}
			${Base64_Decode} $config
			Pop $0
			${WriteFile} "$INSTDIR\agent_conf.json" $0
			;MessageBox MB_OK "config: $config $0 $INSTDIR	"
			nsJSON::Set /file $INSTDIR\agent_conf.json
			; Read address from agent_conf.json
			ClearErrors
			nsJSON::Get `address`
			${IfNot} ${Errors}
				Pop $R0
				StrCpy $address $R0
				${StrRep} $address $address "wss://" "https://"
				${StrRep} $address $address "ws://" "http://"
			${EndIf}
		${EndIf}
	${EndIf}

	IfFileExists $INSTDIR\*.* Upgrades Standard
		Upgrades:
			StrCpy $UPGRADE "true"
		Standard:
			StrCpy $AUTO_UPGRADE "false"

	IfFileExists $INSTDIR\noobaa-s3rest.exe Auto_Upgrades Auto_Standard
		Auto_Upgrades:
			StrCpy $AUTO_UPGRADE "true"
		Auto_Standard:

	${If} $UPGRADE == 'true' ;delete all files that we want to update
		${If} $AUTO_UPGRADE == "false" ;delete all files that we want to update
			nsExec::ExecToStack '$\"$INSTDIR\service_uninstaller.bat$\""'
		${EndIf}
		Delete "$INSTDIR\config.js"
		Delete "$INSTDIR\package.json"
		Delete "$INSTDIR\${ICON}"
		Delete "$INSTDIR\uninstall-noobaa-S3REST.exe"
		RMDir /r "$INSTDIR\node_modules"
		RMDir /r "$INSTDIR\src"
		Delete "$INSTDIR\service.bat"
		Delete "$INSTDIR\service_uninstaller.bat"
		Delete "$INSTDIR\service_installer.bat"

	${Else}
		File "7za.exe"
		File "NooBaa_Agent_wd.exe"
		File "wget.exe"
	${EndIf}

	WriteUninstaller "$INSTDIR\uninstall-noobaa-S3REST.exe"
	File "${ICON}"
	File "NooBaa_Agent_wd.exe"
	File "7za.exe"


		${If} ${RunningX64}
	    # 64 bit code
			File ".\64\openssl.exe"
			File ".\64\libeay32.dll"
			File ".\64\ssleay32.dll"
			File ".\64\node.exe"
			RMDir /r "$INSTDIR\build"
			File /r  "build"
			RMDir /r "$INSTDIR\build\Release-32"
			Rename $INSTDIR\build\Release-64 $INSTDIR\build\Release

		${Else}
	    # 32 bit code
			File ".\32\openssl.exe"
			File ".\32\libeay32.dll"
			File ".\32\ssleay32.dll"
			File ".\32\node.exe"
			RMDir /r "$INSTDIR\build"
			File /r  "build"
			RMDir /r "$INSTDIR\build\Release-64"
			Rename $INSTDIR\build\Release-32 $INSTDIR\build\Release

		${EndIf}


	File "package.json"
	File "wget.exe"
	file "config.js"
	File /r "ssl"
	File /r "src"
	File /r "node_modules"

	${WriteFile} "$INSTDIR\service.bat" "@echo off"
	${WriteFile} "$INSTDIR\service.bat" "rem Version 0.1"
	${WriteFile} "$INSTDIR\service.bat" "  cd $\"$INSTDIR$\""
	${WriteFile} "$INSTDIR\service.bat" "set OPENSSL_CONF=$INSTDIR\ssl\openssl.cnf "
	${WriteFile} "$INSTDIR\service.bat" "$\"$INSTDIR\node.exe$\" $\"$INSTDIR\src\s3\s3rver_starter.js$\" "
	${WriteFile} "$INSTDIR\service.bat" "  set level=$\"%errorlevel%$\""
	${WriteFile} "$INSTDIR\service.bat" "  echo %level% "
	${WriteFile} "$INSTDIR\service.bat" "  if $\"%level%$\" == $\"0$\" ("
	${WriteFile} "$INSTDIR\service.bat" "  		echo Upgrading..."
	${WriteFile} "$INSTDIR\service.bat" "  		wget -t 2 --no-check-certificate $address/public/noobaa-s3rest.exe"
	${WriteFile} "$INSTDIR\service.bat" "  		if exist noobaa-s3rest.exe ("
	${WriteFile} "$INSTDIR\service.bat" "    		noobaa-s3rest.exe /S"
	${WriteFile} "$INSTDIR\service.bat" "    		del noobaa-s3rest.exe"
	${WriteFile} "$INSTDIR\service.bat" "  		)"
	${WriteFile} "$INSTDIR\service.bat" ")"

	${WriteFile} "$INSTDIR\service_installer.bat" "cd $\"$INSTDIR$\""
	${WriteFile} "$INSTDIR\service_installer.bat" "NooBaa_Agent_wd.exe install $\"Noobaa S3REST Service$\" $\"$INSTDIR\service.bat$\""
	${WriteFile} "$INSTDIR\service_installer.bat" "NooBaa_Agent_wd set $\"Noobaa S3REST Service$\" AppStderr $\"$INSTDIR\Noobaa_S3REST_Service.log$\""
	${WriteFile} "$INSTDIR\service_installer.bat" "NooBaa_Agent_wd set $\"Noobaa S3REST Service$\" AppStdout $\"$INSTDIR\Noobaa_S3REST_Service.log$\""
	${WriteFile} "$INSTDIR\service_installer.bat" "NooBaa_Agent_wd.exe start $\"Noobaa S3REST Service$\""
	CreateDirectory "${SMDIR}"
	CreateShortCut "${SMDIR}\${UNINST}.lnk" "$INSTDIR\uninstall-noobaa-S3REST.exe"
	nsExec::ExecToStack '$\"$INSTDIR\service_installer.bat$\""'
SectionEnd

Section "uninstall"
	nsExec::ExecToStack '$\"$INSTDIR\NooBaa_Agent_wd stop "Noobaa S3REST Service" >> "$INSTDIR\uninstall.log"'
	nsExec::ExecToStack '$\"$INSTDIR\NooBaa_Agent_wd remove "Noobaa S3REST Service" confirm >> "$INSTDIR\uninstall.log"'
	Delete "$INSTDIR\NooBaa_Agent_wd.exe"
	Delete "$INSTDIR\config.js"
	Delete "$INSTDIR\7za.exe"
	Delete "$INSTDIR\package.json"
	Delete "$INSTDIR\${ICON}"
	Delete "$INSTDIR\uninstall-noobaa-S3REST.exe"
	Delete "$SMSTARTUP\${NB}.lnk"
	Delete "${SMDIR}\${NB}.lnk"
	Delete "${SMDIR}\${UNINST}.lnk"
	Delete "$INSTDIR\node.exe"
	RMDir /r "$INSTDIR\logs"
	RMDir "${SMDIR}"
	RMDir /r "$INSTDIR"
SectionEnd
