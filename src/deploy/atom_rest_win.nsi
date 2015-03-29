!define NB "NooBaaS3REST"
!define ICON "noobaa_icon24.ico"
!define SMDIR "$SMPROGRAMS\${NB}"
!define UNINST "Uninstall-${NB}"
!include "FileFunc.nsh"
!include "StrFunc.nsh"

; Usage example:
; noobaa-setup.exe /address=noobaa-alpha.herokuapp.com /serverport=443 /agentport=4003 /updateserver=noobaa-alpha.herokuapp.com

SilentInstall silent
OutFile "noobaa-s3rest-setup.exe"
Name "${NB}"
Icon "${ICON}"
InstallDir "$PROGRAMFILES\${NB}"
RequestExecutionLevel admin
Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

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

; GetParameters
; input, none
; output, top of stack (replaces, with e.g. whatever)
; modifies no other variables.

Function GetParameters

Push $R0
Push $R1
Push $R2
Push $R3

StrCpy $R2 1
StrLen $R3 $CMDLINE

;Check for quote or space
StrCpy $R0 $CMDLINE $R2
StrCmp $R0 '"' 0 +3
	StrCpy $R1 '"'
	Goto loop
StrCpy $R1 " "

loop:
	IntOp $R2 $R2 + 1
	StrCpy $R0 $CMDLINE 1 $R2
	StrCmp $R0 $R1 get
	StrCmp $R2 $R3 get
	Goto loop

get:
	IntOp $R2 $R2 + 1
	StrCpy $R0 $CMDLINE 1 $R2
	StrCmp $R0 " " get
	StrCpy $R0 $CMDLINE "" $R2

Pop $R3
Pop $R2
Pop $R1
Exch $R0

FunctionEnd
Function StrStr
Exch $R1 ; st=haystack,old$R1, $R1=needle
Exch    ; st=old$R1,haystack
Exch $R2 ; st=old$R1,old$R2, $R2=haystack
Push $R3
Push $R4
Push $R5
StrLen $R3 $R1
StrCpy $R4 0
; $R1=needle
; $R2=haystack
; $R3=len(needle)
; $R4=cnt
; $R5=tmp
loop:
	StrCpy $R5 $R2 $R3 $R4
	StrCmp $R5 $R1 done
	StrCmp $R5 "" done
	IntOp $R4 $R4 + 1
	Goto loop
done:
StrCpy $R1 $R2 "" $R4
Pop $R5
Pop $R4
Pop $R3
Pop $R2
Exch $R1
FunctionEnd

; GetParameterValue
; Chris Morgan<cmorgan@alum.wpi.edu> 5/10/2004
; -Updated 4/7/2005 to add support for retrieving a command line switch
;  and additional documentation
;
; Searches the command line input, retrieved using GetParameters, for the
; value of an option given the option name.  If no option is found the
; default value is placed on the top of the stack upon function return.
;
; This function can also be used to detect the existence of just a
; command line switch like /OUTPUT  Pass the default and "OUTPUT"
; on the stack like normal.  An empty return string "" will indicate
; that the switch was found, the default value indicates that
; neither a parameter or switch was found.
;
; Inputs - Top of stack is default if parameter isn't found,
;  second in stack is parameter to search for, ex. "OUTPUT"
; Outputs - Top of the stack contains the value of this parameter
;  So if the command line contained /OUTPUT=somedirectory, "somedirectory"
;  will be on the top of the stack when this function returns
;
; Register usage
;$R0 - default return value if the parameter isn't found
;$R1 - input parameter, for example OUTPUT from the above example
;$R2 - the length of the search, this is the search parameter+2
;      as we have '/OUTPUT='
;$R3 - the command line string
;$R4 - result from StrStr calls
;$R5 - search for ' ' or '"'

Function GetParameterValue
Exch $R0  ; get the top of the stack(default parameter) into R0
Exch      ; exchange the top of the stack(default) with
			; the second in the stack(parameter to search for)
Exch $R1  ; get the top of the stack(search parameter) into $R1

;Preserve on the stack the registers used in this function
Push $R2
Push $R3
Push $R4
Push $R5

Strlen $R2 $R1+2    ; store the length of the search string into R2

Call GetParameters  ; get the command line parameters
Pop $R3             ; store the command line string in R3

# search for quoted search string
StrCpy $R5 '"'      ; later on we want to search for a open quote
Push $R3            ; push the 'search in' string onto the stack
Push '"/$R1='       ; push the 'search for'
Call StrStr         ; search for the quoted parameter value
Pop $R4
StrCpy $R4 $R4 "" 1   ; skip over open quote character, "" means no maxlen
StrCmp $R4 "" "" next ; if we didn't find an empty string go to next

# search for non-quoted search string
StrCpy $R5 ' '      ; later on we want to search for a space since we
					; didn't start with an open quote '"' we shouldn't
					; look for a close quote '"'
Push $R3            ; push the command line back on the stack for searching
Push '/$R1='        ; search for the non-quoted search string
Call StrStr
Pop $R4

; $R4 now contains the parameter string starting at the search string,
; if it was found
next:
StrCmp $R4 "" check_for_switch ; if we didn't find anything then look for
								; usage as a command line switch
# copy the value after /$R1= by using StrCpy with an offset of $R2,
# the length of '/OUTPUT='
StrCpy $R0 $R4 "" $R2  ; copy commandline text beyond parameter into $R0
# search for the next parameter so we can trim this extra text off
Push $R0
Push $R5            ; search for either the first space ' ', or the first
					; quote '"'
					; if we found '"/output' then we want to find the
					; ending ", as in '"/output=somevalue"'
					; if we found '/output' then we want to find the first
					; space after '/output=somevalue'
Call StrStr         ; search for the next parameter
Pop $R4
StrCmp $R4 "" done  ; if 'somevalue' is missing, we are done
StrLen $R4 $R4      ; get the length of 'somevalue' so we can copy this
					; text into our output buffer
StrCpy $R0 $R0 -$R4 ; using the length of the string beyond the value,
					; copy only the value into $R0
goto done           ; if we are in the parameter retrieval path skip over
					; the check for a command line switch

; See if the parameter was specified as a command line switch, like '/output'
check_for_switch:
Push $R3            ; push the command line back on the stack for searching
Push '/$R1'         ; search for the non-quoted search string
Call StrStr
Pop $R4
StrCmp $R4 "" done  ; if we didn't find anything then use the default
StrCpy $R0 ""       ; otherwise copy in an empty string since we found the
					; parameter, just didn't find a value

done:
Pop $R5
Pop $R4
Pop $R3
Pop $R2
Pop $R1
Exch $R0 ; put the value in $R0 at the top of the stack
FunctionEnd


# default section
Section "install"

	;Debug:
	;MessageBox MB_OK "Value of address parameter is $2 $3 $4 $5"

	Var /global UPGRADE
	;Install or upgrade?
	StrCpy $UPGRADE "false" ; default - clean installation
	IfFileExists $INSTDIR\*.* 0 +2
	StrCpy $UPGRADE "true"


	${If} $UPGRADE == 'true' ;delete all files that we want to update
		nsExec::ExecToStack '$\"$INSTDIR\service_uninstaller.bat$\""'
		Delete "$INSTDIR\config.js"
		Delete "$INSTDIR\package.json"
		Delete "$INSTDIR\agent_conf.conf"
		Delete "$INSTDIR\${ICON}"
		Delete "$INSTDIR\uninstall-noobaa-S3REST.exe"
		RMDir "$INSTDIR\atom-shell"
		RMDir /r "$INSTDIR\node_modules"
		RMDir /r "$INSTDIR\src"
		Delete "$INSTDIR\service.bat"
		Delete "$INSTDIR\service_uninstaller.bat"
		Delete "$INSTDIR\service_installer.bat"

	${Else}
		File "7za.exe"
		File "NooBaa_Agnet_wd.exe"
		File "libeay32.dll"
		File "libiconv2.dll"
		File "libintl3.dll"
		File "libssl32.dll"
		File "wget.exe"

	${EndIf}

	SetOutPath $INSTDIR
	WriteUninstaller "$INSTDIR\uninstall-noobaa-S3REST.exe"
	File "${ICON}"
	File "NooBaa_Agnet_wd.exe"
	File "7za.exe"
	File "libeay32.dll"
	File "libiconv2.dll"
	File "libintl3.dll"
	File "libssl32.dll"
	File "package.json"
	File "wget.exe"
	file "agent_conf.json"
	file "config.js"
	File /r "src"
	File /r "node_modules"
	file /r "atom-shell"
	${WriteFile} "$INSTDIR\service.bat" "@echo off"
	${WriteFile} "$INSTDIR\service.bat" "rem Version 0.1"
	${WriteFile} "$INSTDIR\service.bat" ">service.log ("
	${WriteFile} "$INSTDIR\service.bat" "  cd $\"$INSTDIR$\""
	${WriteFile} "$INSTDIR\service.bat" "  rem upgrade only if service is up and running"
	${WriteFile} "$INSTDIR\service.bat" "  $\"$INSTDIR\nssm$\" status 'Noobaa S3REST Service'"
	${WriteFile} "$INSTDIR\service.bat" "  set level=$\"%errorlevel%$\""
	${WriteFile} "$INSTDIR\service.bat" "  echo %level% "
	${WriteFile} "$INSTDIR\service.bat" "  if $\"%level%$\" == $\"0$\" ("
	${WriteFile} "$INSTDIR\service.bat" "  		echo Upgrading..."
	${WriteFile} "$INSTDIR\service.bat" "  		wget -t 1 https://s3-eu-west-1.amazonaws.com/noobaa-download/ness/noobaa-s3rest-setup.exe"
	${WriteFile} "$INSTDIR\service.bat" "  		if exist noobaa-s3rest-setup.exe ("
	${WriteFile} "$INSTDIR\service.bat" "    		noobaa-s3rest-setup.exe"
	${WriteFile} "$INSTDIR\service.bat" "    		del noobaa-s3rest-setup.exe"
	${WriteFile} "$INSTDIR\service.bat" "  		)"
	${WriteFile} "$INSTDIR\service.bat" ")"
	${WriteFile} "$INSTDIR\service.bat" "$\"$INSTDIR\atom-shell\atom.exe$\" $\"$INSTDIR\src\s3\index.js$\" "
	${WriteFile} "$INSTDIR\service.bat" ")"
	${WriteFile} "$INSTDIR\service_installer.bat" "cd $\"$INSTDIR$\""
	${WriteFile} "$INSTDIR\service_installer.bat" "nssm install $\"Noobaa S3REST Service$\" $\"$INSTDIR\service.bat$\""
	${WriteFile} "$INSTDIR\service_installer.bat" "nssm start $\"Noobaa S3REST Service$\""
	CreateDirectory "${SMDIR}"
	CreateShortCut "${SMDIR}\${UNINST}.lnk" "$INSTDIR\uninstall-noobaa-S3REST.exe"
	nsExec::ExecToStack '$\"$INSTDIR\service_installer.bat$\""'
SectionEnd

Section "uninstall"
	nsExec::ExecToStack 'nssm stop "Noobaa S3REST Service" >> "$INSTDIR\uninstall.log"'
	nsExec::ExecToStack 'nssm remove "Noobaa S3REST Service" confirm >> "$INSTDIR\uninstall.log"'
	Delete "$INSTDIR\NooBaa_Agnet_wd.exe"
	Delete "$INSTDIR\config.js"
	Delete "$INSTDIR\7za.exe"
	Delete "$INSTDIR\package.json"
	Delete "$INSTDIR\${ICON}"
	Delete "$INSTDIR\ffmpegsumo.dll"
	Delete "$INSTDIR\icudt.dll"
	Delete "$INSTDIR\libEGL.dll"
	Delete "$INSTDIR\libGLESv2.dll"
	Delete "$INSTDIR\uninstall-noobaa-S3REST.exe"
	Delete "$SMSTARTUP\${NB}.lnk"
	Delete "${SMDIR}\${NB}.lnk"
	Delete "${SMDIR}\${UNINST}.lnk"
	RMDir /r "$INSTDIR\atom-shell"
	RMDir /r "$INSTDIR\logs"
	RMDir "${SMDIR}"
	RMDir /r "$INSTDIR"
SectionEnd
