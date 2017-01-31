Unicode true
!include "MUI2.nsh"
!define NB "NooBaa"
!define Version "0.1.0.0"
!define ICON "noobaa_icon24.ico"
!define SMDIR "$SMPROGRAMS\${NB}"
!define UNINST "Uninstall-${NB}"
!include "FileFunc.nsh"
!include "StrFunc.nsh"
${StrRep}
!include "CharToASCII.nsh"
!include "LogicLib.nsh"
!include "Base64.nsh"
!include x64.nsh

!define MAX_PATH 2600
!define NSIS_MAX_STRLEN=8192

; Usage example:
; noobaa-setup.exe /address "wss://noobaa-alpha.herokuapp.com" /S /system_name demo /access_key 123 /secret_key abc
;
; or
;
; noobaa-setup.exe /S /config <agent_conf.json with base 64 encoding>
;
BrandingText "${NB}"
OutFile "noobaa-setup.exe"

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




	;Install or upgrade?
	StrCpy $UPGRADE "false"


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
					MessageBox MB_OK "We are missing the /config parameter. Please copy the config value from the 'Add Node' wizard and run the setup again"
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


Section "Noobaa Local Service"
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
			IfFileExists $INSTDIR\agent_conf.json AbortInstall SkipDelete
			AbortInstall:
				MessageBox MB_OK "Agent already installed"
				Abort ;do not let to install on existing deployment

			SkipDelete:

			${Base64_Decode} $config
			Pop $0
			${WriteFile} "$INSTDIR\agent_conf.json" $0
			;MessageBox MB_OK "config: $config $0 $INSTDIR	"
			nsJSON::Set /file $INSTDIR\agent_conf.json
			; Read address from agent_conf.json
			ClearErrors
			nsJSON::Get `address` /end
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

	IfFileExists $INSTDIR\noobaa-setup.exe Auto_Upgrades Auto_Standard
		Auto_Upgrades:
			StrCpy $AUTO_UPGRADE "true"
		Auto_Standard:

	${If} $UPGRADE == "true" ;delete all files that we want to update

		${If} $AUTO_UPGRADE == "false" ;delete all files that we want to update
			nsExec::ExecToStack '$\"$INSTDIR\service_uninstaller.bat$\""'
		${EndIf}
		Delete "$INSTDIR\config.js"
		Delete "$INSTDIR\package.json"
		Delete "$INSTDIR\${ICON}"
		Delete "$INSTDIR\uninstall-noobaa.exe"
		#No need for atom any more. Keep for future use?!
		#RMDir "$INSTDIR\atom-shell"
		RMDir /r "$INSTDIR\node_modules"
		RMDir /r "$INSTDIR\src"
		RMDir /r "$INSTDIR\ssl"
		${If} $AUTO_UPGRADE == "false" ;delete all files that we want to update
			Delete "$INSTDIR\service_uninstaller.bat"
			Delete "$INSTDIR\service_installer.bat"
			Delete "$INSTDIR\node.exe"
			Delete "$INSTDIR\service.bat"
			RMDir /r "$INSTDIR\build"
		${EndIf}
	${Else}
		File "7za.exe"
		File "NooBaa_Agent_wd.exe"
		File "wget.exe"

	${EndIf}

	WriteUninstaller "$INSTDIR\uninstall-noobaa.exe"
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
		WriteRegStr HKLM "Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\NooBaa" \
			 "DisplayName" "NooBaa Local Service"
		WriteRegStr HKLM "Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\NooBaa" \
            "QuietUninstallString" "$\"$INSTDIR\uninstall-noobaa.exe$\" /S"
		WriteRegStr HKLM "Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\NooBaa" \
	        "UninstallString" "$\"$INSTDIR\uninstall-noobaa.exe$\""

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
		WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\NooBaa" \
			 "DisplayName" "NooBaa Local Service"
		WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\NooBaa" \
            "QuietUninstallString" "$\"$INSTDIR\uninstall-noobaa.exe$\" /S"
		WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\NooBaa" \
			"UninstallString" "$\"$INSTDIR\uninstall-noobaa.exe$\""

	${EndIf}

	File "package.json"
	File "wget.exe"
	File "config.js"
	File /r "ssl"
	File /r "src"
	File /r "node_modules"

	Delete "$INSTDIR\ver.txt"

	${If} $AUTO_UPGRADE == "false" ;delete all files that we want to update

		${WriteFile} "$INSTDIR\service.bat" "@echo on"
		${WriteFile} "$INSTDIR\service.bat" "rem Version 0.1"
		${WriteFile} "$INSTDIR\service.bat" "cd $\"$INSTDIR$\""
		${WriteFile} "$INSTDIR\service.bat" "set OPENSSL_CONF=$INSTDIR\ssl\openssl.cnf "
		${WriteFile} "$INSTDIR\service.bat" "$\"$INSTDIR\node.exe$\" $\"$INSTDIR\src\agent\agent_wrap.js$\" "
		${WriteFile} "$INSTDIR\service_installer.bat" "cd $\"$INSTDIR$\""
		${WriteFile} "$INSTDIR\service_installer.bat" "NooBaa_Agent_wd install $\"Noobaa Local Service$\" $\"$INSTDIR\service.bat$\""
		${WriteFile} "$INSTDIR\service_installer.bat" "NooBaa_Agent_wd start $\"Noobaa Local Service$\""
		${WriteFile} "$INSTDIR\service_installer.bat" "echo Agent Installation completed successfully."

		${WriteFile} "$INSTDIR\service_uninstaller.bat" "cd $\"$INSTDIR$\""
		${WriteFile} "$INSTDIR\service_uninstaller.bat" "NooBaa_Agent_wd stop $\"Noobaa Local Service$\""
		${WriteFile} "$INSTDIR\service_uninstaller.bat" "NooBaa_Agent_wd remove $\"Noobaa Local Service$\" confirm"
		${WriteFile} "$INSTDIR\service_uninstaller.bat" "cd .."
		${WriteFile} "$INSTDIR\service_uninstaller.bat" "del /f/s/q $\"$INSTDIR$\" > nul"
		${WriteFile} "$INSTDIR\service_uninstaller.bat" "rmdir /s/q $\"$INSTDIR$\""
		CreateDirectory "${SMDIR}"
		CreateShortCut "${SMDIR}\${UNINST}.lnk" "$INSTDIR\uninstall-noobaa.exe"
		nsExec::ExecToStack '$\"$INSTDIR\service_installer.bat$\""'
${EndIf}

SectionEnd



Section "uninstall"
	;Variable that will be used in order to pass parameters to the cmd
	Var /global cmdparams
	;The /c parameter means terminate at the end of execution of the command
	;We just spawn NodeJS script that will delete agent_storage from all drives
	StrCpy $cmdparams '/c ""$INSTDIR\node.exe" "$INSTDIR\src\agent\agent_uninstall.js" --remove_agent_storage"'
	;Exec wait means that will we wait until the completion of the command
	ExecWait 'cmd.exe $cmdparams'
	;nsExec::ExecToStack 'NooBaa_Agent_wd stop "Noobaa Local Service" >> "$INSTDIR\uninstall.log"'
	;sleep 2000
	;nsExec::ExecToStack 'NooBaa_Agent_wd remove "Noobaa Local Service" confirm >> "$INSTDIR\uninstall.log"'
	;sleep 2000
	nsExec::ExecToStack '$\"$INSTDIR\service_uninstaller.bat$\""'
	${If} ${RunningX64}
		DeleteRegKey HKLM "Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\NooBaa"
	${Else}
		DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\NooBaa"
	${EndIf}
	Delete "$INSTDIR\NooBaa_Agent_wd.exe"
	Delete "$INSTDIR\config.js"
	Delete "$INSTDIR\7za.exe"
	Delete "$INSTDIR\package.json"
	Delete "$INSTDIR\${ICON}"
	Delete "$INSTDIR\uninstall-noobaa.exe"
	Delete "$SMSTARTUP\${NB}.lnk"
	Delete "${SMDIR}\${NB}.lnk"
	Delete "${SMDIR}\${UNINST}.lnk"
	RMDir "$INSTDIR\atom-shell"
	RMDir "$INSTDIR\logs"
	RMDir "${SMDIR}"
	RMDir /r "$INSTDIR"
SectionEnd
