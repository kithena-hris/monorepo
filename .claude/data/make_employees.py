"""1,000 employees of a fictional company, Meridian Freight & Logistics, as an
HR system would export them: every column a real HRIS export tends to carry,
with formats that vary by country. Seeded, so the same file comes out every run.

All people, numbers and accounts are invented. National IDs use ranges that are
never issued (US SSNs from 900-, UK NI prefix "TN", and so on).
"""
import csv, random, datetime as dt, sys

R = random.Random(20261002)
TODAY = dt.date(2026, 10, 2)
OUT = sys.argv[1] if len(sys.argv) > 1 else "meridian-freight-employees-1000.csv"

# --- places: office, legal entity, currency, address style ------------------------------------
OFFICES = [
    # code, office, city, region, postal, country, iso, entity, currency, tz, phone cc, weight
    ("CHI", "Chicago HQ", "Chicago", "IL", "60606", "United States", "US", "Meridian Freight Inc.", "USD", "America/Chicago", "+1", 300),
    ("ATL", "Atlanta Hub", "Atlanta", "GA", "30354", "United States", "US", "Meridian Freight Inc.", "USD", "America/New_York", "+1", 120),
    ("DAL", "Dallas Distribution Center", "Dallas", "TX", "75261", "United States", "US", "Meridian Freight Inc.", "USD", "America/Chicago", "+1", 110),
    ("TOR", "Toronto Office", "Toronto", "ON", "M5V 2T6", "Canada", "CA", "Meridian Freight Canada Ltd.", "CAD", "America/Toronto", "+1", 70),
    ("LON", "London Office", "London", "", "EC2A 4NE", "United Kingdom", "GB", "Meridian Freight UK Ltd", "GBP", "Europe/London", "+44", 110),
    ("HAM", "Hamburg Port Office", "Hamburg", "HH", "20457", "Germany", "DE", "Meridian Freight GmbH", "EUR", "Europe/Berlin", "+49", 80),
    ("MAD", "Madrid Office", "Madrid", "MD", "28046", "Spain", "ES", "Meridian Freight España S.L.", "EUR", "Europe/Madrid", "+34", 60),
    ("BLR", "Bengaluru Tech Center", "Bengaluru", "KA", "560103", "India", "IN", "Meridian Freight Technologies Pvt. Ltd.", "INR", "Asia/Kolkata", "+91", 150),
]
OFFICE_W = [o[-1] for o in OFFICES]

NAMES = {
    "US": (["James","Mary","Robert","Patricia","Michael","Jennifer","William","Linda","David","Elizabeth","Richard","Barbara","Joseph","Susan","Thomas","Jessica","Charles","Sarah","Christopher","Karen","Daniel","Lisa","Matthew","Nancy","Anthony","Betty","Mark","Sandra","Donald","Ashley","Steven","Kimberly","Andrew","Emily","Joshua","Donna","Kevin","Michelle","Brian","Carol","Marcus","Tanisha","Luis","Maria","Carlos","Ana","Wei","Mei","Hiroshi","Aaliyah","DeShawn","Keisha","Jamal","Priya","Omar","Fatima","Tyler","Brittany","Hunter","Madison"],
           ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez","Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin","Lee","Perez","Thompson","White","Harris","Sanchez","Clark","Ramirez","Lewis","Robinson","Walker","Young","Allen","King","Wright","Scott","Torres","Nguyen","Hill","Flores","Green","Adams","Nelson","Baker","Hall","Rivera","Campbell","Mitchell","Carter","Roberts","Kowalski","O'Brien","Chen","Patel","Washington","Okafor"]),
    "CA": (["Liam","Olivia","Noah","Emma","Ethan","Charlotte","Lucas","Amelia","Benjamin","Ava","Jacob","Sophie","Gabriel","Chloé","Mathieu","Élodie","Arjun","Simran","Jun","Hana"],
           ["Tremblay","Gagnon","Roy","Côté","Bouchard","Gauthier","Morin","Lavoie","Fortin","Smith","Brown","Wilson","MacDonald","Campbell","Singh","Li","Wong","Leblanc","Pelletier","Bélanger"]),
    "GB": (["Oliver","Amelia","George","Isla","Harry","Ava","Jack","Mia","Charlie","Ivy","Thomas","Lily","Oscar","Grace","William","Freya","James","Florence","Alfie","Poppy","Rhys","Siobhan","Callum","Niamh","Aisha","Rohan"],
           ["Smith","Jones","Taylor","Brown","Williams","Wilson","Johnson","Davies","Patel","Robinson","Wright","Thompson","Evans","Walker","White","Roberts","Green","Hall","Thomas","Clarke","Jackson","Wood","Hughes","Khan","Murphy","MacLeod"]),
    "DE": (["Maximilian","Sophie","Alexander","Marie","Paul","Emilia","Leon","Hannah","Lukas","Emma","Felix","Mia","Jonas","Lena","Niklas","Anna","Tim","Laura","Jan","Julia","Mehmet","Ayşe"],
           ["Müller","Schmidt","Schneider","Fischer","Weber","Meyer","Wagner","Becker","Schulz","Hoffmann","Schäfer","Koch","Bauer","Richter","Klein","Wolf","Schröder","Neumann","Schwarz","Zimmermann","Yılmaz","Kaya"]),
    "ES": (["Hugo","Lucía","Martín","Sofía","Pablo","Martina","Daniel","María","Alejandro","Julia","Adrián","Paula","Álvaro","Valeria","Javier","Carmen","Diego","Elena","Sergio","Laura"],
           ["García","Rodríguez","González","Fernández","López","Martínez","Sánchez","Pérez","Gómez","Martín","Jiménez","Ruiz","Hernández","Díaz","Moreno","Muñoz","Álvarez","Romero","Alonso","Navarro"]),
    "IN": (["Aarav","Ananya","Vivaan","Diya","Aditya","Isha","Arjun","Kavya","Sai","Meera","Rohan","Priya","Karthik","Lakshmi","Vikram","Sneha","Rahul","Pooja","Siddharth","Neha","Arun","Divya","Harish","Nandini"],
           ["Sharma","Verma","Iyer","Reddy","Nair","Gupta","Patel","Rao","Kumar","Singh","Menon","Pillai","Joshi","Kulkarni","Desai","Mehta","Chatterjee","Banerjee","Krishnan","Subramanian","Bhat","Shetty","Naidu","Agarwal"]),
}
STREETS = {
    "US": ["Maple Ave","Oak St","Lakeview Dr","Washington Blvd","Cedar Ln","Elm St","Park Pl","Pine Ridge Rd","Highland Ave","Sunset Blvd","Willow Way","2nd St","Madison Ave","River Rd"],
    "CA": ["Queen St W","King St E","Bloor St W","Dundas St","Spadina Ave","Yonge St","College St","Bathurst St"],
    "GB": ["High Street","Station Road","Church Lane","Victoria Road","Park Road","Mill Lane","Kingsway","Green Lane"],
    "DE": ["Hauptstraße","Schulstraße","Gartenstraße","Bahnhofstraße","Dorfstraße","Bergstraße","Lindenstraße","Elbchaussee"],
    "ES": ["Calle Mayor","Calle de Alcalá","Gran Vía","Paseo de la Castellana","Calle de Serrano","Calle de Atocha","Calle de Velázquez"],
    "IN": ["MG Road","Outer Ring Road","100 Feet Road","Sarjapur Road","Bannerghatta Road","Hosur Road","Old Airport Road"],
}
HOME_CITIES = {  # nearby places people actually live
    "CHI": [("Chicago","IL","606"),("Evanston","IL","602"),("Oak Park","IL","603"),("Naperville","IL","605"),("Schaumburg","IL","601")],
    "ATL": [("Atlanta","GA","303"),("Decatur","GA","300"),("Marietta","GA","300"),("College Park","GA","303")],
    "DAL": [("Dallas","TX","752"),("Irving","TX","750"),("Plano","TX","750"),("Arlington","TX","760"),("Grapevine","TX","760")],
    "TOR": [("Toronto","ON","M4"),("Mississauga","ON","L5"),("Brampton","ON","L6"),("Markham","ON","L3")],
    "LON": [("London","","E"),("London","","N"),("London","","SW"),("Croydon","","CR"),("Watford","","WD")],
    "HAM": [("Hamburg","HH","22"),("Hamburg","HH","21"),("Pinneberg","SH","254"),("Norderstedt","SH","228")],
    "MAD": [("Madrid","MD","280"),("Alcobendas","MD","281"),("Getafe","MD","289"),("Pozuelo de Alarcón","MD","282")],
    "BLR": [("Bengaluru","KA","5600"),("Bengaluru","KA","5601"),("Whitefield","KA","5600"),("Electronic City","KA","5601")],
}

def pick(xs): return R.choice(xs)
FEMALE = set("Mary Patricia Jennifer Linda Elizabeth Barbara Susan Jessica Sarah Karen Lisa Nancy Betty Sandra Ashley Kimberly Emily Donna Michelle Carol Tanisha Maria Ana Mei Aaliyah Keisha Priya Fatima Brittany Madison Olivia Emma Charlotte Amelia Ava Sophie Chloé Élodie Simran Hana Isla Mia Ivy Lily Grace Freya Florence Poppy Siobhan Niamh Aisha Marie Emilia Hannah Lena Anna Laura Julia Ayşe Lucía Sofía Martina María Paula Valeria Carmen Elena Ananya Diya Isha Kavya Meera Lakshmi Sneha Pooja Neha Divya Nandini".split())
USED_EMAILS = set()
def rdate(a, b): return a + dt.timedelta(days=R.randint(0, max(0, (b - a).days)))
def iso(d): return d.isoformat() if d else ""

def postal(iso2, city_prefix):
    if iso2 == "US": return city_prefix + f"{R.randint(0,99):02d}"
    if iso2 == "CA": return f"{city_prefix}{R.choice('ABCEGHJKLMNPRSTVXY')} {R.randint(1,9)}{R.choice('ABCEGHJKLMNPRSTVXY')}{R.randint(1,9)}"
    if iso2 == "GB": return f"{city_prefix}{R.randint(1,20)} {R.randint(1,9)}{R.choice('ABDEFGHJLNPQRSTUWXYZ')}{R.choice('ABDEFGHJLNPQRSTUWXYZ')}"
    if iso2 == "DE": return city_prefix + "".join(str(R.randint(0,9)) for _ in range(5 - len(city_prefix)))
    if iso2 == "ES": return city_prefix + "".join(str(R.randint(0,9)) for _ in range(5 - len(city_prefix)))
    return city_prefix + "".join(str(R.randint(0,9)) for _ in range(6 - len(city_prefix)))

def phone(cc, iso2):
    if iso2 in ("US", "CA"): return f"{cc} ({R.randint(201,989)}) 555-{R.randint(100,199):04d}"  # 555-01xx: reserved for fiction
    if iso2 == "GB": return f"{cc} 7700 900{R.randint(0,999):03d}"  # Ofcom drama range
    if iso2 == "DE": return f"{cc} 151 {R.randint(1000000,9999999)}"
    if iso2 == "ES": return f"{cc} 6{R.randint(10,99)} {R.randint(100,999)} {R.randint(100,999)}"
    return f"{cc} 9{R.randint(100,999)} {R.randint(10000,99999)}"

def national_id(iso2):
    if iso2 == "US": return f"9{R.randint(10,99)}-{R.randint(70,88)}-{R.randint(1000,9999)}"  # 9xx: never issued
    if iso2 == "CA": return f"0{R.randint(10,99)} {R.randint(100,999)} {R.randint(100,999)}"   # starting 0: never issued
    if iso2 == "GB": return f"TN {R.randint(10,99)} {R.randint(10,99)} {R.randint(10,99)} {R.choice('ABCD')}"  # TN: temporary/test
    if iso2 == "DE": return f"{R.randint(10,99)} {R.randint(100000,999999)} {R.choice('ABCDEFGH')} {R.randint(100,999)}"
    if iso2 == "ES": n = R.randint(10000000, 99999999); return f"{n}{'TRWAGMYFPDXBNJZSQVHLCKE'[n % 23]}"
    return f"{R.choice('ABCDEFGHJKLMNPQRSTUVWXYZ')*1}{R.choice('ABCDEFGHJKLMNPQRSTUVWXYZ')}{R.choice('ABCDEFGHJKLMNPQRSTUVWXYZ')}P{R.choice('ABCDEFGHJKLMNPQRSTUVWXYZ')}{R.randint(1000,9999)}{R.choice('ABCDEFGHJKLMNPQRSTUVWXYZ')}"  # PAN shape

def bank(iso2):
    if iso2 == "US": return pick(["Chase","Bank of America","Wells Fargo","Citibank","US Bank","PNC"]), "", f"0{R.randint(10000000,99999999)}", f"{R.randint(100000000,999999999)}"
    if iso2 == "CA": return pick(["RBC Royal Bank","TD Canada Trust","Scotiabank","BMO"]), "", f"{R.randint(1000000,9999999)}", f"0{R.randint(1000,9999)}-{R.randint(100,999)}"
    if iso2 == "GB": return pick(["Barclays","HSBC UK","Lloyds Bank","NatWest","Monzo"]), f"GB{R.randint(10,99)}NWBK{R.randint(100000,999999)}{R.randint(10000000,99999999)}", f"{R.randint(10000000,99999999)}", f"{R.randint(10,99)}-{R.randint(10,99)}-{R.randint(10,99)}"
    if iso2 == "DE": return pick(["Deutsche Bank","Commerzbank","Hamburger Sparkasse","ING Deutschland"]), f"DE{R.randint(10,99)}2005{R.randint(1000,9999)}{R.randint(1000000000,9999999999)}", "", ""
    if iso2 == "ES": return pick(["Banco Santander","BBVA","CaixaBank","Bankinter"]), f"ES{R.randint(10,99)}2100{R.randint(1000,9999)}{R.randint(10,99)}{R.randint(1000000000,9999999999)}", "", ""
    return pick(["HDFC Bank","ICICI Bank","State Bank of India","Axis Bank"]), "", f"{R.randint(10**11, 10**12-1)}", f"HDFC0{R.randint(100000,999999)}"

# --- organisation -------------------------------------------------------------------------------
DEPTS = {
    # department: (division, job family, cost centre, [(title, level)], weight)
    "Executive": ("Corporate", "Leadership", "CC-100", [], 0),
    "Finance": ("Corporate", "Finance", "CC-210", [("Accountant","P2"),("Senior Accountant","P3"),("Financial Analyst","P2"),("Payroll Specialist","P2"),("Accounts Payable Clerk","P1"),("Tax Manager","M1")], 45),
    "People": ("Corporate", "Human Resources", "CC-220", [("HR Business Partner","P3"),("Recruiter","P2"),("Talent Acquisition Coordinator","P1"),("Compensation Analyst","P3"),("HR Generalist","P2")], 35),
    "Legal & Compliance": ("Corporate", "Legal", "CC-230", [("Corporate Counsel","P4"),("Compliance Analyst","P2"),("Paralegal","P1"),("Customs Compliance Specialist","P3")], 18),
    "Engineering": ("Technology", "Software Engineering", "CC-310", [("Software Engineer","P2"),("Senior Software Engineer","P3"),("Staff Engineer","P4"),("QA Engineer","P2"),("Site Reliability Engineer","P3"),("Mobile Engineer","P2")], 160),
    "Data & Analytics": ("Technology", "Data", "CC-320", [("Data Analyst","P2"),("Data Engineer","P3"),("Data Scientist","P3"),("BI Developer","P2")], 40),
    "IT": ("Technology", "IT", "CC-330", [("IT Support Specialist","P1"),("Systems Administrator","P2"),("Security Analyst","P3"),("Network Engineer","P3")], 35),
    "Product": ("Technology", "Product", "CC-340", [("Product Manager","P3"),("Senior Product Manager","P4"),("Product Designer","P3"),("UX Researcher","P2")], 30),
    "Operations": ("Operations", "Logistics Operations", "CC-410", [("Operations Coordinator","P1"),("Dispatcher","P1"),("Logistics Planner","P2"),("Operations Supervisor","M1"),("Route Planner","P2")], 140),
    "Warehouse": ("Operations", "Warehouse", "CC-420", [("Warehouse Associate","H1"),("Forklift Operator","H1"),("Inventory Control Specialist","H2"),("Shift Lead","H3"),("Loading Dock Supervisor","M1")], 150),
    "Fleet": ("Operations", "Transport", "CC-430", [("Truck Driver (CDL-A)","H2"),("Fleet Technician","H2"),("Fleet Coordinator","P1")], 70),
    "Customer Success": ("Commercial", "Customer Service", "CC-510", [("Customer Service Representative","P1"),("Account Manager","P2"),("Customer Success Manager","P3"),("Claims Specialist","P2")], 70),
    "Sales": ("Commercial", "Sales", "CC-520", [("Sales Development Representative","P1"),("Account Executive","P2"),("Senior Account Executive","P3"),("Sales Operations Analyst","P2")], 65),
    "Marketing": ("Commercial", "Marketing", "CC-530", [("Marketing Specialist","P2"),("Content Writer","P1"),("Growth Marketing Manager","P3"),("Brand Designer","P2")], 25),
    "Procurement": ("Corporate", "Procurement", "CC-240", [("Buyer","P2"),("Procurement Specialist","P2"),("Vendor Manager","P3")], 15),
}
OFFICE_DEPTS = {  # where each department actually sits
    "CHI": None, "ATL": ["Operations","Warehouse","Fleet","Customer Success","Sales"], "DAL": ["Operations","Warehouse","Fleet","Customer Success"],
    "TOR": ["Operations","Sales","Customer Success","Finance","Warehouse"], "LON": ["Sales","Finance","Legal & Compliance","Operations","Customer Success","Marketing","People"],
    "HAM": ["Operations","Warehouse","Legal & Compliance","Sales","Fleet"], "MAD": ["Operations","Sales","Customer Success","Warehouse"],
    "BLR": ["Engineering","Data & Analytics","IT","Product","Finance","Customer Success"],
}
LEVEL_PAY_USD = {"H1": (34000, 42000), "H2": (42000, 58000), "H3": (52000, 66000), "P1": (45000, 60000), "P2": (60000, 85000), "P3": (85000, 125000), "P4": (125000, 175000),
                 "M1": (90000, 130000), "M2": (130000, 175000), "D1": (170000, 230000), "VP": (230000, 320000), "C": (320000, 480000)}
FX = {"USD": 1, "CAD": 1.36, "GBP": 0.79, "EUR": 0.92, "INR": 83.0}
PAY_MULT = {"US": 1.0, "CA": 0.92, "GB": 0.88, "DE": 0.9, "ES": 0.68, "IN": 0.32}

rows = []
def make_person(i, office, dept, title, level, hire_floor=None):
    iso2 = office[6]
    gender = R.choices(["Female","Male","Non-binary","Prefer not to say",""], weights=[47,49,1,1.5,1.5])[0]
    pool = [x for x in NAMES[iso2][0] if (x in FEMALE) == (gender == "Female")] if gender in ("Female", "Male") else NAMES[iso2][0]
    first = pick(pool or NAMES[iso2][0]); last = pick(NAMES[iso2][1])
    middle = pick(NAMES[iso2][0])[0] + "." if R.random() < 0.35 else ""
    preferred = {"Robert":"Bob","William":"Will","Christopher":"Chris","Michael":"Mike","Jennifer":"Jen","Alexander":"Alex","Maximilian":"Max","Elizabeth":"Liz","Siddharth":"Sid","Benjamin":"Ben","Matthew":"Matt","Joshua":"Josh","Nicholas":"Nick","Katherine":"Kate"}.get(first, "") if R.random() < 0.6 else ""
    pronouns = {"Female":"she/her","Male":"he/him","Non-binary":"they/them"}.get(gender, "")
    senior = level in ("M2","D1","VP","C")
    birth = rdate(TODAY - dt.timedelta(days=365*(62 if senior else 60)), TODAY - dt.timedelta(days=365*(34 if senior else 20)))
    earliest = max(dt.date(2004, 3, 1), birth + dt.timedelta(days=365*19), hire_floor or dt.date(2004, 3, 1))
    hire = rdate(earliest, TODAY - dt.timedelta(days=30))
    rehire = R.random() < 0.04
    original_hire = rdate(max(birth + dt.timedelta(days=365*18), hire - dt.timedelta(days=365*8)), hire - dt.timedelta(days=400)) if rehire else hire
    if R.random() < 0.03: hire = rdate(TODAY + dt.timedelta(days=5), TODAY + dt.timedelta(days=75))  # joining soon
    status, term, term_reason, rehire_ok = "Active", None, "", ""
    roll = R.random()
    if hire > TODAY: status = "Pre-hire"
    elif roll < 0.06:
        status = "Terminated"; term = rdate(hire + dt.timedelta(days=60), TODAY - dt.timedelta(days=1))
        term_reason = pick(["Resignation - new opportunity","Resignation - relocation","Resignation - personal","Retirement","Involuntary - performance","Involuntary - restructuring","End of contract"])
        rehire_ok = "No" if "performance" in term_reason else "Yes"
    elif roll < 0.09: status = "On leave"
    elif roll < 0.10: status = "Notice period"; term = rdate(TODAY + dt.timedelta(days=7), TODAY + dt.timedelta(days=60)); term_reason = "Resignation - new opportunity"; rehire_ok = "Yes"
    leave_type = pick(["Parental leave","Medical leave","Sabbatical","Unpaid personal leave"]) if status == "On leave" else ""
    leave_start = rdate(TODAY - dt.timedelta(days=120), TODAY - dt.timedelta(days=3)) if leave_type else None
    leave_end = (leave_start + dt.timedelta(days=R.randint(30, 200))) if leave_start else None
    emp_type = "Full-time"
    if level.startswith("H") and R.random() < 0.18: emp_type = "Part-time"
    if R.random() < 0.05 and not senior: emp_type = pick(["Contractor","Fixed-term"])
    if R.random() < 0.015 and level in ("P1",): emp_type = "Intern"
    fte = 1.0 if emp_type != "Part-time" else pick([0.5, 0.6, 0.75, 0.8])
    hours = {"US": 40, "CA": 40, "GB": 37.5, "DE": 40, "ES": 40, "IN": 45}[iso2] * fte
    lo, hi = LEVEL_PAY_USD[level]
    usd = R.uniform(lo, hi) * PAY_MULT[iso2]
    cur = office[8]
    hourly = level.startswith("H")
    base = round(usd * FX[cur], -2)
    hourly_rate = round(base / (hours * 52), 2) if hourly else ""
    pay_type = "Hourly" if hourly else "Salaried"
    pay_freq = {"US": "Bi-weekly", "CA": "Bi-weekly", "GB": "Monthly", "DE": "Monthly", "ES": "Monthly (14 payments)", "IN": "Monthly"}[iso2]
    flsa = ("Non-exempt" if hourly or level == "P1" else "Exempt") if iso2 == "US" else ""
    bonus = {"C": 60, "VP": 40, "D1": 25, "M2": 20, "M1": 15, "P4": 15, "P3": 10, "P2": 7.5, "P1": 5}.get(level, 0) if not hourly else 0
    commission = pick(["10% of gross margin", "6% of new ARR", "Tiered, see plan"]) if dept == "Sales" and "Account" in title else ""
    equity = (R.randint(2, 60) * 500) if level in ("P3","P4","M1","M2","D1","VP","C") and R.random() < 0.7 else ""
    city, region, prefix = pick(HOME_CITIES[office[0]])
    street_no = R.randint(1, 9800) if iso2 in ("US","CA") else R.randint(1, 180)
    street = f"{street_no} {pick(STREETS[iso2])}" if iso2 in ("US","CA","GB","IN") else f"{pick(STREETS[iso2])} {street_no}"
    line2 = pick(["Apt 4B","Unit 12","Apt 1203","Flat 3","2. OG","3º Izq.","Flat 22, Block C",""]) if R.random() < 0.35 else ""
    marital = pick(["Single","Married","Married","Domestic partnership","Divorced","Widowed",""])
    dependents = R.choice([0,0,0,1,1,2,2,3,4]) if marital not in ("Single","") else R.choice([0,0,0,1])
    ec_rel = pick(["Spouse","Partner","Mother","Father","Sibling","Friend"]) if marital in ("Married","Domestic partnership") or R.random() < 0.5 else pick(["Mother","Father","Sibling","Friend"])
    ec_name = f"{pick(NAMES[iso2][0])} {last if ec_rel in ('Spouse','Mother','Father','Sibling') and R.random() < 0.7 else pick(NAMES[iso2][1])}"
    bank_name, iban, acct, routing = bank(iso2)
    nationality = {"US":"American","CA":"Canadian","GB":"British","DE":"German","ES":"Spanish","IN":"Indian"}[iso2]
    work_auth, permit_type, permit_no, permit_exp = "Citizen", "", "", None
    if R.random() < 0.12:
        nationality = pick(["Indian","Mexican","Brazilian","Polish","Filipino","Nigerian","Chinese","Turkish","Irish","Italian","Ukrainian"])
        work_auth = "Work permit"
        permit_type = {"US":"H-1B","CA":"LMIA work permit","GB":"Skilled Worker visa","DE":"EU Blue Card","ES":"Highly Qualified Professional visa","IN":"Employment visa"}[iso2]
        permit_no = f"{R.choice('EWX')}{R.randint(10000000, 99999999)}"
        permit_exp = rdate(TODAY - dt.timedelta(days=20), TODAY + dt.timedelta(days=900))
    passport_no = f"{R.choice('ABCKLMNPXZ')}{R.randint(1000000, 9999999)}" if R.random() < 0.6 else ""
    passport_exp = rdate(TODAY + dt.timedelta(days=40), TODAY + dt.timedelta(days=3600)) if passport_no else None
    work_email_local = (preferred or first).lower() + "." + last.lower()
    import unicodedata
    work_email_local = unicodedata.normalize("NFKD", work_email_local.replace("ß","ss").replace("ı","i")).encode("ascii","ignore").decode().replace("'","").replace(" ","")
    base_local, k = work_email_local, 2
    while work_email_local in USED_EMAILS: work_email_local = f"{base_local}{k}"; k += 1
    USED_EMAILS.add(work_email_local)
    personal_domain = pick(["gmail.com","outlook.com","yahoo.com","icloud.com","proton.me","hotmail.com"])
    work_arr = "Onsite" if level.startswith("H") or dept in ("Fleet","Warehouse") else pick(["Hybrid","Hybrid","Onsite","Remote"])
    shift = pick(["Day (06:00-14:30)","Swing (14:00-22:30)","Night (22:00-06:30)"]) if dept in ("Warehouse",) else ("Rotating" if dept == "Fleet" else "")
    review = rdate(TODAY - dt.timedelta(days=330), TODAY - dt.timedelta(days=20)) if hire < TODAY - dt.timedelta(days=200) else None
    raise_d = rdate(max(hire, TODAY - dt.timedelta(days=700)), TODAY - dt.timedelta(days=10)) if hire < TODAY - dt.timedelta(days=300) and R.random() < 0.8 else None
    edu = pick(["High school diploma","Associate degree","Bachelor's degree","Bachelor's degree","Master's degree","MBA","PhD","Vocational certificate"]) if not level.startswith("H") else pick(["High school diploma","Vocational certificate","Some college",""])
    uni = pick(["University of Illinois","Georgia Tech","UT Austin","University of Toronto","University of Manchester","Universität Hamburg","Universidad Complutense de Madrid","IIT Madras","Visvesvaraya Technological University","Northwestern University","Purdue University","DePaul University"]) if edu in ("Bachelor's degree","Master's degree","MBA","PhD") else ""
    skills_pool = {"Engineering": ["TypeScript","Go","Kubernetes","PostgreSQL","React","AWS","Terraform","Kafka"], "Data & Analytics": ["SQL","Python","dbt","Looker","Spark","Statistics"], "Warehouse": ["Forklift certified","WMS","Inventory counts","OSHA 10"], "Fleet": ["CDL-A","Hazmat endorsement","DOT regulations","Diesel maintenance"], "Sales": ["Salesforce","Negotiation","Freight pricing"], "Finance": ["NetSuite","IFRS","US GAAP","Excel"], "Operations": ["TMS","Route optimisation","Incoterms","Customs brokerage"]}
    skills = "; ".join(R.sample(skills_pool.get(dept, ["Excel","Communication","Project management"]), k=min(3, len(skills_pool.get(dept, ["a","b","c"])))))
    langs = {"US": "English", "CA": pick(["English","English; French"]), "GB": "English", "DE": "German; English", "ES": "Spanish; English", "IN": pick(["English; Hindi","English; Kannada","English; Tamil","English; Telugu"])}[iso2]
    if R.random() < 0.15: langs += "; " + pick(["Spanish","Polish","Mandarin","Portuguese","Arabic","Turkish"])
    return {
        "Employee Number": f"MF{i:05d}",
        "Person ID": f"{R.randint(0x10000000, 0xffffffff):08x}-{R.randint(0x1000,0xffff):04x}-7{R.randint(0x100,0xfff):03x}-{R.choice('89ab')}{R.randint(0x100,0xfff):03x}-{R.randint(0x100000000000, 0xffffffffffff):012x}",
        "Legal First Name": first, "Middle Name": middle, "Legal Last Name": last, "Preferred Name": preferred,
        "Pronouns": pronouns, "Gender": gender, "Date of Birth": iso(birth),
        "Marital Status": marital, "Number of Dependents": dependents, "Nationality": nationality,
        "Ethnicity": pick(["White","Hispanic or Latino","Black or African American","Asian","Two or more races","Prefer not to say",""]) if iso2 == "US" else "",
        "Veteran Status": pick(["Not a protected veteran","Not a protected veteran","Protected veteran","Prefer not to say"]) if iso2 == "US" else "",
        "Disability Status": pick(["No","No","No","Yes","Prefer not to say"]),
        "Religion": pick(["","","","Christian","Muslim","Hindu","Jewish","None","Prefer not to say"]) if iso2 in ("DE","IN") else "",  # DE church tax; IN recorded by some employers
        "Work Email": f"{work_email_local}@meridianfreight.example",
        "Personal Email": f"{work_email_local.replace('.', R.choice(['.','_','']))}{R.randint(1,99) if R.random() < 0.5 else ''}@{personal_domain}",
        "Work Phone": {"US": "+1 (312) 555-0100", "CA": "+1 (416) 555-0100", "GB": "+44 20 7946 0000", "DE": "+49 40 3290 0000", "ES": "+34 91 555 0000", "IN": "+91 80 4040 0000"}[iso2] + f" ext. {R.randint(1000,4999)}" if R.random() < 0.6 and not level.startswith("H") else "",
        "Mobile Phone": phone(office[10], iso2),
        "Home Address Line 1": street, "Home Address Line 2": line2, "Home City": city, "Home State/Province": region,
        "Home Postal Code": postal(iso2, prefix), "Home Country": office[5],
        "Emergency Contact Name": ec_name, "Emergency Contact Relationship": ec_rel, "Emergency Contact Phone": phone(office[10], iso2),
        "National ID (SSN/NI/SIN/PAN)": national_id(iso2), "Tax ID / Steuer-ID": f"{R.randint(10,99)} {R.randint(100,999)} {R.randint(100,999)} {R.randint(100,999)}" if iso2 == "DE" else "",
        "Passport Number": passport_no, "Passport Expiry": iso(passport_exp),
        "Work Authorization": work_auth, "Work Permit Type": permit_type, "Work Permit Number": permit_no, "Work Permit Expiry": iso(permit_exp),
        "Driver License Number": f"{R.choice('ABCDEFGHJKLMNPRSTW')}{R.randint(100,999)}-{R.randint(1000,9999)}-{R.randint(1000,9999)}" if dept == "Fleet" or R.random() < 0.2 else "",
        "Driver License Class": "CDL Class A" if dept == "Fleet" and iso2 in ("US","CA") else ("C+E" if dept == "Fleet" else ""),
        "Driver License Expiry": iso(rdate(TODAY - dt.timedelta(days=15), TODAY + dt.timedelta(days=1800))) if dept == "Fleet" else "",
        "Hire Date": iso(hire), "Original Hire Date": iso(original_hire), "Seniority Date": iso(original_hire if rehire and R.random() < 0.5 else hire),
        "Probation End Date": iso(hire + dt.timedelta(days={"US": 90, "CA": 90, "GB": 180, "DE": 180, "ES": 180, "IN": 180}[iso2])),
        "Employment Status": status, "Leave Type": leave_type, "Leave Start Date": iso(leave_start), "Expected Return Date": iso(leave_end),
        "Termination Date": iso(term), "Termination Reason": term_reason, "Eligible for Rehire": rehire_ok,
        "Employment Type": emp_type, "Contract End Date": iso(rdate(TODAY + dt.timedelta(days=20), TODAY + dt.timedelta(days=500))) if emp_type in ("Contractor","Fixed-term","Intern") else "",
        "FTE": fte, "Standard Weekly Hours": hours, "Shift": shift, "Work Arrangement": work_arr,
        "Job Title": title, "Job Level": level, "Job Family": DEPTS[dept][1], "Department": dept, "Division": DEPTS[dept][0],
        "Cost Center": DEPTS[dept][2] + "-" + office[0], "Legal Entity": office[7], "Work Location": office[1],
        "Work Location Address": {"CHI":"233 S Wacker Dr, Chicago, IL 60606","ATL":"1600 Aviation Blvd, Atlanta, GA 30354","DAL":"2400 Aviation Dr, DFW Airport, TX 75261","TOR":"100 King St W, Toronto, ON M5X 1A9","LON":"30 Finsbury Square, London EC2A 1AG","HAM":"Am Sandtorkai 41, 20457 Hamburg","MAD":"Paseo de la Castellana 259, 28046 Madrid","BLR":"Embassy TechVillage, Outer Ring Road, Bengaluru 560103"}[office[0]],
        "Time Zone": office[9], "Manager Employee Number": "", "Manager Name": "", "Manager Email": "",
        "Pay Type": pay_type, "FLSA Status": flsa, "Pay Frequency": pay_freq, "Currency": cur,
        "Annual Base Salary": "" if hourly else f"{base:.2f}", "Hourly Rate": hourly_rate,
        "Bonus Target %": bonus or "", "Commission Plan": commission, "Equity Grant (Units)": equity,
        "Last Raise Date": iso(raise_d), "Last Raise %": round(R.uniform(2.0, 9.5), 1) if raise_d else "",
        "Last Performance Review Date": iso(review), "Performance Rating": pick(["Exceeds expectations","Meets expectations","Meets expectations","Meets expectations","Needs improvement","Outstanding"]) if review else "",
        "Bank Name": bank_name, "IBAN": iban, "Bank Account Number": acct, "Routing / Sort / IFSC Code": routing,
        "Tax Filing Status": pick(["Single","Married filing jointly","Head of household"]) if iso2 == "US" else ({"DE": f"Steuerklasse {pick(['I','III','IV','V'])}", "GB": f"Tax code {pick(['1257L','1257L','BR','K475'])}", "IN": pick(["New regime","Old regime"])}.get(iso2, "")),
        "Benefits Plan": pick(["PPO Gold","PPO Silver","HDHP + HSA","HMO","Waived"]) if iso2 == "US" else ({"CA": pick(["Sun Life Extended Health","Waived"]), "GB": pick(["Bupa Private Medical","Vitality","None"]), "IN": pick(["Group Mediclaim Family","Group Mediclaim Self"])}.get(iso2, "Statutory")),
        "Retirement Plan": {"US": f"401(k) {pick([3,4,5,6,8,10])}%", "CA": "Group RRSP", "GB": f"Workplace pension {pick([5,6,8])}%", "DE": "bAV Direktversicherung" if R.random() < 0.4 else "", "ES": "", "IN": "EPF"}[iso2],
        "Annual Leave Balance (days)": round(R.uniform(0, 28), 1), "Sick Leave Balance (days)": round(R.uniform(0, 12), 1),
        "Union Member": pick(["Yes","No","No"]) if dept in ("Warehouse","Fleet") else "No",
        "Highest Education": edu, "University": uni, "Languages": langs, "Skills": skills,
        "Certifications": pick({"Engineering": ["AWS Solutions Architect","CKA (Kubernetes)"], "IT": ["CISSP","CompTIA Security+","CCNA"], "Data & Analytics": ["Google Data Analytics","Databricks Associate"], "Finance": ["CPA","ACCA","CMA"], "People": ["SHRM-CP","CIPD Level 5"], "Operations": ["APICS CLTD","CSCP","Customs Broker License"], "Procurement": ["CIPS","CPSM"], "Warehouse": ["Forklift (OSHA)","OSHA 10"], "Fleet": ["Hazmat (DOT)","ASE Diesel"], "Product": ["CSPO","Pragmatic Marketing"], "Sales": ["Certified Freight Agent"], "Legal & Compliance": ["CIPP/E","Licensed Customs Broker"]}.get(dept, ["PMP"])) if R.random() < 0.35 else "",
        "T-Shirt Size": pick(["XS","S","M","M","L","L","XL","XXL"]) if R.random() < 0.85 else "",
        "Dietary Requirements": pick(["Vegetarian","Vegan","Halal","Kosher","Gluten-free","Nut allergy","Lactose intolerant"]) if R.random() < 0.18 else "",
        "Laptop Serial": f"C02{''.join(R.choice('ABCDEFGHJKLMNPQRSTUVWXYZ0123456789') for _ in range(9))}" if work_arr != "Onsite" or not level.startswith("H") else "",
        "Badge Number": f"B-{R.randint(10000, 99999)}", "Parking Spot": f"{office[0]}-P{R.randint(1,3)}-{R.randint(1,240):03d}" if R.random() < 0.3 else "",
        "LinkedIn URL": f"https://www.linkedin.com/in/{work_email_local.replace('.', '-')}-{R.randint(100,999)}" if R.random() < 0.55 and not level.startswith("H") else "",
        "Notes": pick(["","","","","Relocated from another office","Converted from contractor","Returning after parental leave","Internal transfer","Referred by an employee"]),
        "_office": office, "_dept": dept, "_level": level,
    }

# --- build the hierarchy top-down ----------------------------------------------------------------
chi = OFFICES[0]
n = 1
ceo = make_person(n, chi, "Executive", "Chief Executive Officer", "C"); rows.append(ceo); n += 1
CXO = [("Chief Financial Officer","Finance"),("Chief Operating Officer","Operations"),("Chief Technology Officer","Engineering"),("Chief People Officer","People"),("Chief Commercial Officer","Sales"),("General Counsel","Legal & Compliance")]
execs = {}
for t, d in CXO:
    p = make_person(n, chi, "Executive" if t != "General Counsel" else "Legal & Compliance", t, "C"); p["_reports"] = d; rows.append(p); execs[d] = p; n += 1
FUNC_OWNER = {"Finance":"Finance","Procurement":"Finance","Operations":"Operations","Warehouse":"Operations","Fleet":"Operations","Engineering":"Engineering","Data & Analytics":"Engineering","IT":"Engineering","Product":"Engineering","People":"People","Sales":"Sales","Customer Success":"Sales","Marketing":"Sales","Legal & Compliance":"Legal & Compliance"}
vps = {}
for dept in DEPTS:
    if dept == "Executive": continue
    p = make_person(n, chi if dept != "Engineering" else pick([chi, OFFICES[7]]), dept, f"VP, {dept}", "VP"); rows.append(p); vps[dept] = p; n += 1
directors = {}
for dept, vp in vps.items():
    sites = [o for o in OFFICES if OFFICE_DEPTS[o[0]] is None or dept in OFFICE_DEPTS[o[0]]]
    for o in sites[: max(1, min(len(sites), DEPTS[dept][4] // 45))]:
        p = make_person(n, o, dept, f"Director, {dept}" + ("" if o is chi else f" ({o[2]})"), "D1"); rows.append(p); directors.setdefault(dept, []).append(p); n += 1
managers = {}
for dept, ds in directors.items():
    for d in ds:
        for _ in range(max(1, round(DEPTS[dept][4] / (8 * len(ds))))):
            p = make_person(n, d["_office"], dept, pick(["Manager","Senior Manager","Team Lead"]) + f", {dept}", pick(["M1","M2"])); rows.append(p); managers.setdefault(dept, []).append(p); n += 1
while len(rows) < 1000:
    office = R.choices(OFFICES, weights=OFFICE_W)[0]
    allowed = [d for d in DEPTS if d != "Executive" and (OFFICE_DEPTS[office[0]] is None or d in OFFICE_DEPTS[office[0]])]
    dept = R.choices(allowed, weights=[DEPTS[d][4] for d in allowed])[0]
    local = [m for m in managers[dept] if m["_office"] is office]
    m = pick(local or managers[dept])
    title, level = pick(DEPTS[dept][3])
    rows.append(make_person(n, office, dept, title, level)); rows[-1]["_mgr"] = m; n += 1

def link(p, m):
    p["Manager Employee Number"] = m["Employee Number"]
    p["Manager Name"] = f"{m['Preferred Name'] or m['Legal First Name']} {m['Legal Last Name']}"
    p["Manager Email"] = m["Work Email"]
for p in rows:
    if p is ceo: continue
    if p["_level"] == "C": link(p, ceo)
    elif p["_level"] == "VP": link(p, execs[FUNC_OWNER[p["_dept"]]])
    elif p["_level"] == "D1": link(p, vps[p["_dept"]])
    elif p["_level"] in ("M1", "M2") and "_mgr" not in p: link(p, pick([d for d in directors[p["_dept"]] if d["_office"] is p["_office"]] or directors[p["_dept"]]))
    else: link(p, p["_mgr"])

# Realistic export noise: a handful of rows with blanks, odd casing and stray spaces.
for p in R.sample(rows[50:], 12): p["Mobile Phone"] = ""
for p in R.sample(rows[50:], 6): p["Work Location"] = p["Work Location"].upper()
for p in R.sample(rows[50:], 5): p["Legal Last Name"] = " " + p["Legal Last Name"] + " "
for p in R.sample(rows[50:], 4): p["Date of Birth"] = ""

cols = [k for k in rows[0] if not k.startswith("_")]
with open(OUT, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
    w.writeheader()
    for p in rows: w.writerow(p)
print(f"{len(rows)} employees, {len(cols)} columns -> {OUT}")
